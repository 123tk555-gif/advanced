import { describe, expect, it } from "vitest";
import { type Expense, settle, type Transfer } from "./settlement.js";

/** 精算をすべて実行したあとに、各自の手元に残る「受け取った額 − 払った額」 */
function applyTransfers(transfers: Transfer[]): Map<string, number> {
  const net = new Map<string, number>();
  for (const t of transfers) {
    net.set(t.from, (net.get(t.from) ?? 0) - t.amount);
    net.set(t.to, (net.get(t.to) ?? 0) + t.amount);
  }
  return net;
}

describe("settle(割り勘の精算)", () => {
  it("支出が無ければ、精算は 0 件", () => {
    expect(settle([])).toEqual([]);
  });

  it("1 人が全員分を払ったら、ほかの人がその人に等分を払う", () => {
    const expenses: Expense[] = [{ amount: 3000, paidBy: "a", splitWith: ["a", "b", "c"] }];
    expect(settle(expenses)).toEqual([
      { from: "b", to: "a", amount: 1000 },
      { from: "c", to: "a", amount: 1000 },
    ]);
  });

  it("全員が同じ額を払ったら、精算は 0 件", () => {
    const expenses: Expense[] = [
      { amount: 2000, paidBy: "a", splitWith: ["a", "b"] },
      { amount: 2000, paidBy: "b", splitWith: ["a", "b"] },
    ];
    expect(settle(expenses)).toEqual([]);
  });

  it("割り切れない額の端数は、払った人の負担になる", () => {
    // 1000 円を 3 人で: 1 人 333 円、端数 1 円は払った a が持つ(a の負担は 334 円)
    const expenses: Expense[] = [{ amount: 1000, paidBy: "a", splitWith: ["a", "b", "c"] }];
    expect(settle(expenses)).toEqual([
      { from: "b", to: "a", amount: 333 },
      { from: "c", to: "a", amount: 333 },
    ]);
  });

  it("払った人が対象に入っていなくても、端数は払った人の負担になる", () => {
    // a が b と c のために 1001 円: b と c は 500 円ずつ。端数 1 円は a が持つ
    const expenses: Expense[] = [{ amount: 1001, paidBy: "a", splitWith: ["b", "c"] }];
    expect(settle(expenses)).toEqual([
      { from: "b", to: "a", amount: 500 },
      { from: "c", to: "a", amount: 500 },
    ]);
  });

  it("複数の支出を差し引きしてから精算する", () => {
    const expenses: Expense[] = [
      { amount: 3000, paidBy: "a", splitWith: ["a", "b", "c"] },
      { amount: 3000, paidBy: "b", splitWith: ["a", "b", "c"] },
    ];
    expect(settle(expenses)).toEqual([
      { from: "c", to: "a", amount: 1000 },
      { from: "c", to: "b", amount: 1000 },
    ]);
  });

  it("送金の回数は「関わった人数 − 1」回以下で、全員の貸し借りがちょうど 0 になる", () => {
    const expenses: Expense[] = [
      { amount: 12000, paidBy: "a", splitWith: ["a", "b", "c", "d", "e"] },
      { amount: 4500, paidBy: "b", splitWith: ["b", "c", "d"] },
      { amount: 7777, paidBy: "c", splitWith: ["a", "c", "e"] },
      { amount: 980, paidBy: "e", splitWith: ["d"] },
    ];
    const transfers = settle(expenses);

    expect(transfers.length).toBeLessThanOrEqual(5 - 1);
    for (const t of transfers) {
      expect(Number.isInteger(t.amount)).toBe(true);
      expect(t.amount).toBeGreaterThan(0);
      expect(t.from).not.toBe(t.to);
    }

    // 精算後の各自の受け取り額 = 各自の「立て替えた額 − 自分の負担」
    // 1 人あたり: 12000/5 = 2400、4500/3 = 1500、7777/3 = 2592(端数 1 円は c)、980/1 = 980
    const net = applyTransfers(transfers);
    expect(net.get("a")).toBe(12000 - 2400 - 2592); // 立て替え 12000、負担 2400 + 2592
    expect(net.get("b")).toBe(4500 - 2400 - 1500);
    expect(net.get("c")).toBe(2592 * 2 - 2400 - 1500); // a と e の分 2592 × 2 を受け取る側、端数は c
    expect(net.get("d")).toBe(-2400 - 1500 - 980);
    expect(net.get("e")).toBe(980 - 2400 - 2592);
    const total = [...net.values()].reduce((sum, v) => sum + v, 0);
    expect(total).toBe(0);
    // d は支払っていない(980 円は e が d のために払った)ので、受け取る側にはならない
    expect(net.get("d") ?? 0).toBeLessThan(0);
  });

  it("同じ入力なら、何度呼んでも同じ結果(並び順も同じ)", () => {
    const expenses: Expense[] = [
      { amount: 5000, paidBy: "x", splitWith: ["x", "y", "z"] },
      { amount: 1200, paidBy: "y", splitWith: ["x", "y", "z"] },
    ];
    expect(settle(expenses)).toEqual(settle([...expenses]));
  });

  it("対象に同じ人が 2 回入っていても、1 人として数える", () => {
    const expenses: Expense[] = [{ amount: 2000, paidBy: "a", splitWith: ["a", "b", "b"] }];
    expect(settle(expenses)).toEqual([{ from: "b", to: "a", amount: 1000 }]);
  });

  it.each([
    ["0 円", { amount: 0, paidBy: "a", splitWith: ["a", "b"] }],
    ["マイナス", { amount: -100, paidBy: "a", splitWith: ["a", "b"] }],
    ["小数", { amount: 100.5, paidBy: "a", splitWith: ["a", "b"] }],
    ["対象が空", { amount: 100, paidBy: "a", splitWith: [] }],
  ])("正しくない支出(%s)はエラーにする", (_label, expense) => {
    expect(() => settle([expense])).toThrow(RangeError);
  });
});
