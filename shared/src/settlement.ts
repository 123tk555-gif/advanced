import { z } from "zod";

/** 1 件の支出。金額は円(整数) */
export interface Expense {
  amount: number;
  /** 立て替えた人の userId */
  paidBy: string;
  /** この支出を分け合う人の userId(払った人を含まなくてもよい) */
  splitWith: readonly string[];
}

/** 精算の 1 回分: from が to に amount 円を払う */
export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

/**
 * 支出の一覧から、誰が誰にいくら払えば貸し借りが 0 になるかを求める。
 *
 * - 1 人あたりの額は切り捨て。割り切れない端数は、払った人の負担になる
 * - 送金の回数は「関わった人数 − 1」回以下(貸しの多い人と借りの多い人から順に組み合わせる)
 * - 同じ入力なら、並び順も含めて同じ結果を返す
 */
export function settle(expenses: readonly Expense[]): Transfer[] {
  const balances = new Map<string, number>();
  const add = (userId: string, diff: number) => {
    balances.set(userId, (balances.get(userId) ?? 0) + diff);
  };

  for (const expense of expenses) {
    validate(expense);
    const people = [...new Set(expense.splitWith)];
    const share = Math.floor(expense.amount / people.length);
    for (const person of people) {
      if (person === expense.paidBy) continue;
      add(person, -share);
      add(expense.paidBy, share);
    }
  }

  const byAmountThenId = (a: [string, number], b: [string, number]) =>
    Math.abs(b[1]) - Math.abs(a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const creditors = [...balances].filter(([, v]) => v > 0).sort(byAmountThenId);
  const debtors = [...balances].filter(([, v]) => v < 0).sort(byAmountThenId);

  const transfers: Transfer[] = [];
  let c = 0;
  let d = 0;
  while (c < creditors.length && d < debtors.length) {
    const creditor = creditors[c] as [string, number];
    const debtor = debtors[d] as [string, number];
    const amount = Math.min(creditor[1], -debtor[1]);
    transfers.push({ from: debtor[0], to: creditor[0], amount });
    creditor[1] -= amount;
    debtor[1] += amount;
    if (creditor[1] === 0) c++;
    if (debtor[1] === 0) d++;
  }
  return transfers;
}

function validate(expense: Expense): void {
  if (!Number.isInteger(expense.amount) || expense.amount <= 0) {
    throw new RangeError(`金額は 1 円以上の整数にしてください: ${expense.amount}`);
  }
  if (expense.splitWith.length === 0) {
    throw new RangeError("分け合う人を 1 人以上選んでください");
  }
}

// ---- 入力のルール(画面と API で共通) ----

/** 1 つの旅の支出の上限 */
export const MAX_EXPENSES_PER_TRIP = 500;
/** 1 件の支出の金額の上限(円) */
export const MAX_EXPENSE_AMOUNT = 10_000_000;

export const expenseCreate = z.object({
  title: z.string().trim().min(1).max(50),
  amount: z.number().int().min(1).max(MAX_EXPENSE_AMOUNT),
  paidBy: z.string().min(1),
  // 同じ人が 2 回あっても 1 人にまとめる(並び順は保つ)
  splitWith: z
    .array(z.string().min(1))
    .min(1)
    .max(100)
    .transform((ids) => [...new Set(ids)]),
});
export type ExpenseCreate = z.infer<typeof expenseCreate>;
