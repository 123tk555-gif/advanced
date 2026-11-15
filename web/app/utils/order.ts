import { compareOrderKey } from "@tritri/shared";
import { generateKeyBetween } from "fractional-indexing";

/** 並び順の計算に使う、予定の最小限の情報 */
export interface Ordered {
  itemId: string;
  day: number;
  order: string;
}

function itemsOfDay(items: readonly Ordered[], day: number): Ordered[] {
  return items.filter((i) => i.day === day).sort((a, b) => compareOrderKey(a.order, b.order));
}

/** その日の最後に足すときの並び順のキー */
export function orderAtEnd(items: readonly Ordered[], day: number): string {
  const last = itemsOfDay(items, day).at(-1);
  return generateKeyBetween(last?.order ?? null, null);
}

/**
 * ↑(dir = -1)・↓(dir = 1)で予定を 1 つ動かしたときの、新しい日にちと並び順を求める。
 * - 同じ日の中では、隣の予定と入れ替わる位置に入る
 * - その日の端では、前の日の最後・次の日の最初へ移る(予定の無い日にも移れる)
 * - 旅の最初の予定を上へ・最後の予定を下へは動かせない(null)
 * 書き換えるのは動かした予定だけ(サーバーには、この予定の day と order だけを送る)。
 */
export function planMove(
  items: readonly Ordered[],
  itemId: string,
  dir: -1 | 1,
  days: number,
): { day: number; order: string } | null {
  const item = items.find((i) => i.itemId === itemId);
  if (!item) return null;
  const sameDay = itemsOfDay(items, item.day);
  const pos = sameDay.findIndex((i) => i.itemId === itemId);

  if (dir === 1 && pos < sameDay.length - 1) {
    const next = sameDay[pos + 1] as Ordered;
    const after = sameDay[pos + 2];
    return { day: item.day, order: generateKeyBetween(next.order, after?.order ?? null) };
  }
  if (dir === -1 && pos > 0) {
    const prev = sameDay[pos - 1] as Ordered;
    const before = sameDay[pos - 2];
    return { day: item.day, order: generateKeyBetween(before?.order ?? null, prev.order) };
  }

  const day = item.day + dir;
  if (day < 1 || day > days) return null;
  const target = itemsOfDay(items, day);
  return dir === 1
    ? { day, order: generateKeyBetween(null, target[0]?.order ?? null) }
    : { day, order: generateKeyBetween(target.at(-1)?.order ?? null, null) };
}
