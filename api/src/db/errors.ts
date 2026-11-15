import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";

/** TransactWrite の書き込み 1 つ分 */
export type TransactItem = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

/**
 * TransactWrite が条件に合わずに取り消されたとき、どの書き込み(番号)の条件で失敗したかを返す。
 * 条件以外の理由(同時の書き込みとの衝突など)なら "conflict"、取り消し以外の例外はそのまま投げる。
 */
export function failedConditionIndex(error: unknown): number | "conflict" {
  if (!(error instanceof TransactionCanceledException)) throw error;
  const reasons = error.CancellationReasons ?? [];
  const index = reasons.findIndex((r) => r.Code === "ConditionalCheckFailed");
  if (index >= 0) return index;
  if (reasons.some((r) => r.Code === "TransactionConflict")) return "conflict";
  throw error;
}

/**
 * 同時の書き込みとぶつかって取り消されたときは、少し待ってやり直す。
 * それ以外の結果・例外はそのまま返す。
 */
export async function retryOnConflict<T>(run: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await run();
    } catch (error) {
      if (i >= attempts || !(error instanceof TransactionCanceledException)) throw error;
      const reasons = error.CancellationReasons ?? [];
      if (!reasons.some((r) => r.Code === "TransactionConflict")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * i + Math.random() * 30));
    }
  }
}
