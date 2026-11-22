import type { Place } from "~/types/api";
import type { LegState } from "./geo/legs";
import type { LatLng } from "./geo/types";

/** 移動手段 */
export const MODES = { walk: "徒歩", transit: "公共交通", car: "車" } as const;
export type Mode = keyof typeof MODES;
export const GOOGLE_MODES: Record<Mode, string> = {
  walk: "walking",
  transit: "transit",
  car: "driving",
};

/** 地図に立てるピン。no は、その日の場所のある予定の中での番号 */
export interface MapPin extends LatLng {
  no: number;
  label: string;
}

export function fmtMinutes(min: number): string {
  return min >= 60 ? `約 ${Math.floor(min / 60)} 時間 ${min % 60} 分` : `約 ${min} 分`;
}

/**
 * 区間の状態を、画面に出す文にする。
 * 経路が無いときに目安の数字は出さない(日本の公共交通は Google が経路を返さず、目安では乗換も待ち時間も入らない)
 */
export function legText(state: LegState): string {
  if (state.status === "loading") return "計算中…";
  if (state.status === "none") return "時間はここでは出せません";
  if (state.status === "failed") return "時間を取得できませんでした";
  return fmtMinutes(state.value.minutes);
}

/** 移動手段つきの文(例: 徒歩で約 12 分、公共交通: 時間はここでは出せません) */
export function legSentence(state: LegState, mode: Mode): string {
  return `${MODES[mode]}${state.status === "ok" ? "で" : ": "}${legText(state)}`;
}

/** 「Google マップで調べる」リンクを出す区間か */
export function needsLookupLink(state: LegState): boolean {
  return state.status === "none" || state.status === "failed";
}

/** その場所を Google マップで開くリンク */
export function googleSearchUrl(place: Place): string {
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", place.label);
  url.searchParams.set("query_place_id", place.placeId);
  return url.toString();
}

/** 経路を Google マップで開くリンク(1 日分にも 1 区間にも使う) */
export function googleRouteUrl(places: Place[], mode: Mode): string | null {
  if (places.length < 2) return null;
  const first = places[0] as Place;
  const last = places.at(-1) as Place;
  const middle = places.slice(1, -1);
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", first.label);
  url.searchParams.set("origin_place_id", first.placeId);
  url.searchParams.set("destination", last.label);
  url.searchParams.set("destination_place_id", last.placeId);
  if (middle.length) {
    // | は経由地の区切りなので、表示名に入っていたら空白にする
    url.searchParams.set("waypoints", middle.map((p) => p.label.replaceAll("|", " ")).join("|"));
    url.searchParams.set("waypoint_place_ids", middle.map((p) => p.placeId).join("|"));
  }
  url.searchParams.set("travelmode", GOOGLE_MODES[mode]);
  return url.toString();
}

/** 地図の模型に描く点(ピンと名前の位置)。近くの名前と重なるときは上下にずらす */
export function layoutPins(places: MapPin[], width: number, height: number, pad = 40) {
  if (places.length === 0) return [];
  const lats = places.map((p) => p.lat);
  const lngs = places.map((p) => p.lng);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180);
  const spanX = Math.max((Math.max(...lngs) - Math.min(...lngs)) * kx, 0.01);
  const spanY = Math.max(Math.max(...lats) - Math.min(...lats), 0.01);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const cx = (Math.min(...lngs) + Math.max(...lngs)) / 2;

  const placed: { left: number; width: number; y: number }[] = [];
  return places.map((p) => {
    const x = width / 2 + (p.lng - cx) * kx * scale;
    const y = height / 2 - (p.lat - midLat) * scale;
    const anchor = x > width - 120 ? "end" : "start";
    const labelWidth = p.label.length * 13 + 20;
    const left = anchor === "end" ? x - 16 - labelWidth : x + 16;
    let ly = y + 5;
    for (let tries = 0; tries < 8; tries++) {
      const hit = placed.find(
        (q) => Math.abs(q.y - ly) < 16 && left < q.left + q.width && q.left < left + labelWidth,
      );
      if (!hit) break;
      ly = hit.y + (ly >= hit.y ? 16 : -16);
    }
    placed.push({ left, width: labelWidth, y: ly });
    return { x, y, ly, anchor, tx: anchor === "end" ? x - 16 : x + 16 } as const;
  });
}
