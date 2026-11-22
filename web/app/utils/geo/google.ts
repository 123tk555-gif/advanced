import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import type { Mode } from "../map";
import { createAuthFailureWatcher } from "./auth";
import type { Leg, PlaceSearch, RouteService } from "./types";

/**
 * Google マップの API を使う版(ブラウザの中だけで動く)。
 * ここには Google の形と、アプリの形の変換だけを置く。覚えておく・待つ・古い答えを捨てるなどの
 * 決まりごとは legs.ts・suggest.ts にあり、単体テストで確かめている。
 *
 * 料金の枠を節約するため、次のようにしている。
 * - 場所の候補は、セッショントークンで「入力 → 1 件選ぶ」を 1 回分の利用にまとめる
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
    async suggest(text) {
      const { AutocompleteSessionToken, AutocompleteSuggestion } = await importLibrary("places");
      token ??= new AutocompleteSessionToken();
      const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: text,
        sessionToken: token,
        language: "ja",
        region: "jp",
      });
      predictions.clear();
      return suggestions.flatMap((s) => {
        const p = s.placePrediction;
        if (!p) return [];
        predictions.set(p.placeId, p);
        return [
          {
            id: p.placeId,
            main: p.mainText?.text ?? p.text.text,
            ...(p.secondaryText?.text ? { sub: p.secondaryText.text } : {}),
          },
        ];
      });
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
