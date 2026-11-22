import type { Place } from "../../types/api";

/** 場所の表示名の上限(shared の placeSchema と同じ) */
export const MAX_LABEL = 200;

/** 候補を選んだときに保存する表示名。Google の候補名は写さず、利用者が入力した文字を使う */
export function labelFromInput(typed: string): string {
  return typed.trim().slice(0, MAX_LABEL);
}

/** 場所の入力の誤り。問題なければ null */
export function placeError(place: Place | null, searchText: string): string | null {
  if (place) return place.label.trim() ? null : "場所の表示名を入力してください";
  if (!searchText.trim()) return null;
  return "場所は候補から選んでください(地図に出すため)。場所を付けないときは空にしてください";
}
