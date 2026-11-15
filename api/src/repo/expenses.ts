import { QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { type ExpenseCreate, MAX_EXPENSES_PER_TRIP } from "@tritri/shared";
import { ulid } from "ulid";
import type { Deps } from "../context.js";
import { failedConditionIndex, retryOnConflict } from "../db/errors.js";
import { keys } from "../db/table.js";

export interface Expense {
  expenseId: string;
  title: string;
  amount: number;
  paidBy: string;
  splitWith: string[];
  createdBy: string;
  createdAt: string;
}

export function toExpense(r: Record<string, unknown>): Expense {
  return {
    expenseId: r.expenseId as string,
    title: r.title as string,
    amount: r.amount as number,
    paidBy: r.paidBy as string,
    splitWith: r.splitWith as string[],
    createdBy: r.createdBy as string,
    createdAt: r.createdAt as string,
  };
}

/** 今のメンバーの userId(最大 50 人) */
async function memberIds(deps: Deps, tripId: string): Promise<Set<string>> {
  const res = await deps.db.send(
    new QueryCommand({
      TableName: deps.tableName,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": keys.tripPk(tripId), ":prefix": "MEMBER#" },
      ProjectionExpression: "userId",
      ConsistentRead: true,
    }),
  );
  return new Set((res.Items ?? []).map((m) => m.userId as string));
}

/**
 * 支出の記録。払った人・分け合う人は今のメンバーだけ。
 * 旅の支出の件数(expenseCount)を同じトランザクションで数え、上限を守る。
 */
export async function createExpense(
  deps: Deps,
  tripId: string,
  userId: string,
  input: ExpenseCreate,
): Promise<{ expense: Expense } | { error: "not_a_member" | "too_many" }> {
  const members = await memberIds(deps, tripId);
  if (![input.paidBy, ...input.splitWith].every((id) => members.has(id))) {
    return { error: "not_a_member" };
  }
  const expense: Expense = {
    expenseId: ulid(),
    ...input,
    createdBy: userId,
    createdAt: deps.now().toISOString(),
  };
  try {
    await retryOnConflict(() =>
      deps.db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: deps.tableName,
                Item: { ...keys.expense(tripId, expense.expenseId), type: "expense", ...expense },
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            {
              Update: {
                TableName: deps.tableName,
                Key: keys.tripMeta(tripId),
                UpdateExpression: "SET expenseCount = if_not_exists(expenseCount, :zero) + :one",
                ConditionExpression:
                  "attribute_exists(PK) AND (attribute_not_exists(expenseCount) OR expenseCount < :max)",
                ExpressionAttributeValues: {
                  ":zero": 0,
                  ":one": 1,
                  ":max": MAX_EXPENSES_PER_TRIP,
                },
              },
            },
          ],
        }),
      ),
    );
    return { expense };
  } catch (error) {
    if (failedConditionIndex(error) === 1) return { error: "too_many" };
    throw error;
  }
}

/** 支出の削除(メンバーなら誰でも)。件数も同じトランザクションで減らす */
export async function deleteExpense(
  deps: Deps,
  tripId: string,
  expenseId: string,
): Promise<"deleted" | "not_found"> {
  try {
    await retryOnConflict(() =>
      deps.db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Delete: {
                TableName: deps.tableName,
                Key: keys.expense(tripId, expenseId),
                ConditionExpression: "attribute_exists(PK)",
              },
            },
            {
              Update: {
                TableName: deps.tableName,
                Key: keys.tripMeta(tripId),
                UpdateExpression: "SET expenseCount = expenseCount - :one",
                // 旅が消えていたら書かない(消えた旅の META を作り直さないように)
                ConditionExpression: "attribute_exists(PK)",
                ExpressionAttributeValues: { ":one": 1 },
              },
            },
          ],
        }),
      ),
    );
    return "deleted";
  } catch (error) {
    if (failedConditionIndex(error) === 0) return "not_found";
    throw error;
  }
}
