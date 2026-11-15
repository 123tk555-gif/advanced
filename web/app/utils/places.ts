import type { Place } from "~/types/api";

/**
 * 場所の候補(仮)。
 * Google マップをつなぐ段階で、Google の Places API の検索に置き換える。
 */
export const PLACES: Place[] = [
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

export function searchPlaces(query: string): Place[] {
  const q = query.trim();
  return q ? PLACES.filter((p) => p.name.includes(q)).slice(0, 8) : [];
}

export function findPlace(name: string): Place | null {
  const p = PLACES.find((x) => x.name === name.trim());
  return p ? { ...p } : null;
}
