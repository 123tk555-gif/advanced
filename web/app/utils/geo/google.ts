import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import type { Mode } from "../map";
import { createAuthFailureWatcher } from "./auth";
import { mergeSuggestions, TRANSIT_TYPES, transitKind } from "./transit";
import type { Leg, PlaceSearch, RouteService, Suggestion } from "./types";

/** 候補で「近く」として優先する範囲。遠くの場所も除きはしない(Google の上限が 50km) */
const NEAR_RADIUS_M = 50_000;

/**
 * Google マップの API を使う版(ブラウザの中だけで動く)。
 * ここには Google の形と、アプリの形の変換だけを置く。覚えておく・待つ・古い答えを捨てるなどの
 * 決まりごとは legs.ts・suggest.ts にあり、単体テストで確かめている。
 *
 * 料金の枠を節約するため、次のようにしている。
 * - 場所の候補は、セッショントークンで「入力 → 1 件選ぶ」を 1 回分の利用にまとめる
 * - 候補はふつうの検索と駅・バス停などの検索の 2 回(最大 10 件)。高い Text Search は使わない
 * - 場所は座標(location)だけを取る。座標はメモリに持つだけで保存しない(Google の規約)
 * - 経路は、所要時間・線・注意だけを取る
 */

let configured = false;
let authFailure: ReturnType<typeof createAuthFailureWatcher> | null = null;
export function configureGoogle(key: string) {
  if (configured) return;
  authFailure = createAuthFailureWatcher(window as Window & { gm_authFailure?: () => void });
  setOptions({ key, v: "weekly", language: "ja", region: "JP" });
  configured = true;
}

/** キーの誤り・制限違反を受け取る(RouteMap から使う) */
export function watchAuthFailure(listener: () => void): () => void {
  return authFailure?.watch(listener) ?? (() => {});
}

const TRAVEL_MODES: Record<Mode, google.maps.TravelModeString> = {
  walk: "WALKING",
  transit: "TRANSIT",
  car: "DRIVING",
};

export function createGooglePlaces(): PlaceSearch {
  let token: google.maps.places.AutocompleteSessionToken | null = null;
  const predictions = new Map<string, google.maps.places.PlacePrediction>();

  return {
    async suggest(text, near) {
      const { AutocompleteSessionToken, AutocompleteSuggestion } = await importLibrary("places");
      token ??= new AutocompleteSessionToken();
      const request: google.maps.places.AutocompleteRequest = {
        input: text,
        sessionToken: token,
        language: "ja",
        region: "jp",
        ...(near ? { locationBias: { center: near, radius: NEAR_RADIUS_M } } : {}),
      };
      // 1 回に 5 件までで増やせないので、駅・バス停などに絞った検索を足す
      const results = await Promise.allSettled([
        AutocompleteSuggestion.fetchAutocompleteSuggestions(request),
        AutocompleteSuggestion.fetchAutocompleteSuggestions({
          ...request,
          includedPrimaryTypes: TRANSIT_TYPES,
        }),
      ]);
      if (results.every((r) => r.status === "rejected")) {
        throw (results[0] as PromiseRejectedResult).reason;
      }
      const [general = [], transit = []] = results.map((result): Suggestion[] => {
        if (result.status === "rejected") return [];
        return result.value.suggestions.flatMap(({ placePrediction: p }) => {
          if (!p) return [];
          predictions.set(p.placeId, p);
          const main = p.mainText?.text ?? p.text.text;
          const kind = transitKind(main, p.types);
          return [
            {
              id: p.placeId,
              main,
              ...(p.secondaryText?.text ? { sub: p.secondaryText.text } : {}),
              ...(kind ? { kind } : {}),
            },
          ];
        });
      });
      return mergeSuggestions(general, transit);
    },

    async resolve(suggestion) {
      const prediction = predictions.get(suggestion.id);
      if (!prediction) return null;
      // 選んだら、そのセッションは終わり。次の入力では新しいトークンを使う
      token = null;
      const place = prediction.toPlace();
      await place.fetchFields({ fields: ["location"] });
      if (!place.location) return null;
      return {
        placeId: place.id,
        position: { lat: place.location.lat(), lng: place.location.lng() },
      };
    },

    async locate(placeId) {
      const { Place: GooglePlace } = await importLibrary("places");
      const place = new GooglePlace({ id: placeId });
      await place.fetchFields({ fields: ["location"] });
      return place.location ? { lat: place.location.lat(), lng: place.location.lng() } : null;
    },
  };
}

export function createGoogleRoutes(): RouteService {
  return {
    async leg(from, to, mode): Promise<Leg | null> {
      const [{ Route }, { Place: GooglePlace }] = await Promise.all([
        importLibrary("routes"),
        importLibrary("places"),
      ]);
      const { routes } = await Route.computeRoutes({
        origin: new GooglePlace({ id: from.placeId }),
        destination: new GooglePlace({ id: to.placeId }),
        travelMode: TRAVEL_MODES[mode],
        fields: ["durationMillis", "path", "warnings"],
        language: "ja",
        region: "jp",
      });
      const route = routes?.[0];
      // 経路が無い(日本の公共交通は、いつもこうなる)。目安の数字は作らない
      if (!route || route.durationMillis == null) return null;
      return {
        minutes: Math.max(1, Math.round(route.durationMillis / 60000)),
        ...(route.path?.length
          ? { path: route.path.map((p) => ({ lat: p.lat, lng: p.lng })) }
          : {}),
        ...(route.warnings?.length ? { warnings: [...route.warnings] } : {}),
      };
    },
  };
}

/** 地図の部品を読み込む(MapPanel から使う) */
export async function loadMapLibraries() {
  const [{ Map: GoogleMap, Polyline }, { AdvancedMarkerElement, PinElement }, { LatLngBounds }] =
    await Promise.all([importLibrary("maps"), importLibrary("marker"), importLibrary("core")]);
  return { GoogleMap, Polyline, LatLngBounds, AdvancedMarkerElement, PinElement };
}
