import type { Place } from "../../types/api";

/**
 * 候補を出すときに「近く」の基準にする場所の ID。
 * その日の最後 → 前の日のいちばん近いもの → 後の日のいちばん近いもの、の順で選ぶ。
 * items は日にち・並び順に並んでいること。座標の問い合わせを増やさないよう 1 か所だけにする。
 */
export function referencePlaceId(
  items: readonly { day: number; place: Place | null }[],
  day: number,
): string | undefined {
  const placed = items.filter((item) => item.place);
  const chosen = placed.findLast((item) => item.day <= day) ?? placed[0];
  return chosen?.place?.placeId;
}
