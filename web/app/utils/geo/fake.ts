import type { Mode } from "../map";
import type { LatLng, PlaceSearch, RouteService } from "./types";

/**
 * Google マップの API キーがないとき(手元で試すとき・自動テスト・CI)に使う、仮の場所と経路。
 * 場所は決まった一覧から探し、徒歩・車の移動時間は直線距離から出した目安にする。
 * 公共交通は、日本の Google と同じく「経路なし」にする。
 */
const PLACES: ({ name: string } & LatLng)[] = [
  { name: "京都駅", lat: 34.9858, lng: 135.7588 },
  { name: "清水寺", lat: 34.9949, lng: 135.785 },
  { name: "伏見稲荷大社", lat: 34.9671, lng: 135.7727 },
  { name: "金閣寺(鹿苑寺)", lat: 35.0394, lng: 135.7292 },
  { name: "銀閣寺(慈照寺)", lat: 35.027, lng: 135.7982 },
  { name: "嵐山 竹林の小径", lat: 35.017, lng: 135.6713 },
  { name: "渡月橋", lat: 35.0128, lng: 135.6778 },
  { name: "二条城", lat: 35.0142, lng: 135.7481 },
  { name: "錦市場", lat: 35.005, lng: 135.7649 },
  { name: "八坂神社", lat: 35.0037, lng: 135.7785 },
  { name: "祇園 花見小路", lat: 35.0019, lng: 135.7752 },
  { name: "南禅寺", lat: 35.0113, lng: 135.7944 },
  { name: "哲学の道", lat: 35.023, lng: 135.7945 },
  { name: "平等院", lat: 34.8893, lng: 135.8077 },
  { name: "京都タワー", lat: 34.9875, lng: 135.7594 },
  { name: "那覇空港", lat: 26.206, lng: 127.6466 },
  { name: "首里城公園", lat: 26.217, lng: 127.7195 },
  { name: "国際通り", lat: 26.2155, lng: 127.689 },
  { name: "沖縄美ら海水族館", lat: 26.6943, lng: 127.8779 },
  { name: "古宇利大橋", lat: 26.6941, lng: 128.0193 },
  { name: "万座毛", lat: 26.505, lng: 127.8506 },
];

const PREFIX = "fake:";

function positionOf(placeId: string): LatLng | null {
  const p = PLACES.find((x) => `${PREFIX}${x.name}` === placeId);
  return p ? { lat: p.lat, lng: p.lng } : null;
}

export const fakePlaces: PlaceSearch = {
  async suggest(text) {
    const q = text.trim();
    if (!q) return [];
    return PLACES.filter((p) => p.name.includes(q))
      .slice(0, 8)
      .map((p) => ({ id: `${PREFIX}${p.name}`, main: p.name }));
  },
  async resolve(suggestion) {
    const position = positionOf(suggestion.id);
    return position ? { placeId: suggestion.id, position } : null;
  },
  async locate(placeId) {
    return positionOf(placeId);
  },
};

function distanceKm(a: LatLng, b: LatLng): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** 移動時間の目安(分)。道のりは直線距離の 1.3 倍とみなす */
export function legMinutes(a: LatLng, b: LatLng, mode: Exclude<Mode, "transit">): number {
  const km = distanceKm(a, b) * 1.3;
  if (mode === "walk") return Math.max(1, Math.round((km / 4.5) * 60));
  return Math.max(3, Math.round((km / 22) * 60) + 3);
}

export const fakeRoutes: RouteService = {
  async leg(from, to, mode) {
    if (mode === "transit") return null;
    const a = positionOf(from.placeId);
    const b = positionOf(to.placeId);
    return a && b ? { minutes: legMinutes(a, b, mode) } : null;
  },
};
