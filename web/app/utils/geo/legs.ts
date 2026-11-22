import type { Place } from "../../types/api";
import type { Mode } from "../map";
import { createLookupStore, type LookupState } from "./store";
import type { Leg, RouteService } from "./types";

/** 区間の状態(画面に出す形) */
export type LegState = LookupState<Leg>;

/** 区間を見分けるキー。表示名は入れない(名前を変えても問い合わせ直さない) */
export function legKey(from: Place, to: Place, mode: Mode): string {
  return JSON.stringify([mode, from.placeId, to.placeId]);
}

/** 区間の移動時間を覚えておく仕組み(覚え方の決まりは store.ts) */
export function createLegStore(service: RouteService, notify: () => void) {
  const requests = new Map<string, [Place, Place, Mode]>();
  const store = createLookupStore<Leg>((key) => {
    const [from, to, mode] = requests.get(key) as [Place, Place, Mode];
    return service.leg(from, to, mode);
  }, notify);

  function get(from: Place, to: Place, mode: Mode): LegState {
    const key = legKey(from, to, mode);
    requests.set(key, [from, to, mode]);
    return store.get(key);
  }

  return { get };
}
