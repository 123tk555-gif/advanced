import { compareOrderKey } from "@tritri/shared";
import { describe, expect, it } from "vitest";
import { orderAtEnd, planMove } from "./order";

/** 並び順のキーを、実際に使う形で作った予定の一覧(日にち → 並び順) */
const items = [
  { itemId: "a", day: 1, order: "a0" },
  { itemId: "b", day: 1, order: "a1" },
  { itemId: "c", day: 1, order: "a2" },
  { itemId: "d", day: 2, order: "a0" },
  { itemId: "e", day: 3, order: "a0" },
];

/** null でないことを確かめてから使う */
function must<T>(value: T | null): T {
  expect(value).not.toBeNull();
  return value as T;
}

/** 動かした結果の並び(日にち → 並び順)を、itemId の列で返す */
function orderAfter(itemId: string, move: { day: number; order: string }) {
  return items
    .map((i) => (i.itemId === itemId ? { ...i, ...move } : i))
    .sort((x, y) => x.day - y.day || compareOrderKey(x.order, y.order))
    .map((i) => `${i.day}:${i.itemId}`);
}

describe("planMove(↑↓ で予定を動かすときの、新しい日にちと並び順)", () => {
  it("同じ日の中で下へ: 次の予定の後ろに入る", () => {
    const move = planMove(items, "a", 1, 3);
    expect(move).not.toBeNull();
    expect(orderAfter("a", must(move))).toEqual(["1:b", "1:a", "1:c", "2:d", "3:e"]);
  });

  it("同じ日の中で上へ: 前の予定の前に入る", () => {
    const move = planMove(items, "c", -1, 3);
    expect(orderAfter("c", must(move))).toEqual(["1:a", "1:c", "1:b", "2:d", "3:e"]);
  });

  it("その日の最後で下へ: 次の日の最初に移る", () => {
    const move = planMove(items, "c", 1, 3);
    expect(move?.day).toBe(2);
    expect(orderAfter("c", must(move))).toEqual(["1:a", "1:b", "2:c", "2:d", "3:e"]);
  });

  it("その日の最初で上へ: 前の日の最後に移る", () => {
    const move = planMove(items, "d", -1, 3);
    expect(move?.day).toBe(1);
    expect(orderAfter("d", must(move))).toEqual(["1:a", "1:b", "1:c", "1:d", "3:e"]);
  });

  it("予定の無い日へも移れる", () => {
    const sparse = [
      { itemId: "x", day: 1, order: "a0" },
      { itemId: "y", day: 3, order: "a0" },
    ];
    expect(planMove(sparse, "x", 1, 3)).toEqual({ day: 2, order: expect.any(String) });
  });

  it("旅の最初の予定を上へ・最後の予定を下へは動かせない(null)", () => {
    expect(planMove(items, "a", -1, 3)).toBeNull();
    expect(planMove(items, "e", 1, 3)).toBeNull();
  });

  it("無い予定は null", () => {
    expect(planMove(items, "zzz", 1, 3)).toBeNull();
  });

  it("動かしたときに変わるのは、動かした予定の日にちと並び順だけ(ほかは書き換えない)", () => {
    const before = JSON.stringify(items);
    planMove(items, "b", 1, 3);
    expect(JSON.stringify(items)).toBe(before);
  });
});

describe("orderAtEnd(その日の最後に足すときの並び順)", () => {
  it("その日の最後の予定より後ろになる", () => {
    const order = orderAtEnd(items, 1);
    expect(compareOrderKey(order, "a2")).toBeGreaterThan(0);
  });

  it("予定の無い日でも作れる", () => {
    expect(orderAtEnd([], 5)).toEqual(expect.any(String));
  });
});
