import type { Place } from "~/types/api";
import { fakePlaces, fakeRoutes } from "~/utils/geo/fake";
import { configureGoogle, createGooglePlaces, createGoogleRoutes } from "~/utils/geo/google";
import { createLegStore, type LegState } from "~/utils/geo/legs";
import { createLookupStore, type LookupState } from "~/utils/geo/store";
import type { LatLng, PlaceSearch, RouteService } from "~/utils/geo/types";
import type { Mode } from "~/utils/map";

interface Geo {
  /** 本物の Google マップを使うか(API キーが設定されているか) */
  google: boolean;
  mapId: string;
  places: PlaceSearch;
  routes: RouteService;
}

let geo: Geo | null = null;

/**
 * 場所の検索と経路。
 * NUXT_PUBLIC_GOOGLE_MAPS_API_KEY があれば Google、なければ仮の場所と目安の移動時間(徒歩・車だけ)を使う
 * (自動テストと CI はキーなしで動く)。
 */
export function useGeo(): Geo {
  if (!geo) {
    const config = useRuntimeConfig().public;
    const key = String(config.googleMapsApiKey ?? "");
    if (key) {
      configureGoogle(key);
      geo = {
        google: true,
        mapId: String(config.googleMapsMapId || "DEMO_MAP_ID"),
        places: createGooglePlaces(),
        routes: createGoogleRoutes(),
      };
    } else {
      geo = { google: false, mapId: "", places: fakePlaces, routes: fakeRoutes };
    }
  }
  return geo;
}

// 座標と区間の移動時間は、画面のどこから聞いても同じものを使う(一覧と地図で二重に問い合わせない)。
// どちらも画面を開いている間だけメモリに持つ。
const legVersion = ref(0);
let legStore: ReturnType<typeof createLegStore> | null = null;

export function useLegs() {
  const { routes } = useGeo();
  legStore ??= createLegStore(routes, () => {
    legVersion.value += 1;
  });
  const store = legStore;
  /** computed の中で呼ぶと、答えが届いたときに計算し直される */
  function leg(from: Place, to: Place, mode: Mode): LegState {
    void legVersion.value;
    return store.get(from, to, mode);
  }
  return { leg };
}

const positionVersion = ref(0);
let positionStore: ReturnType<typeof createLookupStore<LatLng>> | null = null;

export function usePositions() {
  const { places } = useGeo();
  positionStore ??= createLookupStore<LatLng>(
    (placeId) => places.locate(placeId),
    () => {
      positionVersion.value += 1;
    },
  );
  const store = positionStore;
  /** 保存した ID の今の位置。computed の中で呼ぶと、答えが届いたときに計算し直される */
  function positionOf(placeId: string): LookupState<LatLng> {
    void positionVersion.value;
    return store.get(placeId);
  }
  return { positionOf, remember: store.put };
}
