import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { GetCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  type ItemCreate,
  type ItemPatch,
  MAX_ITEMS_PER_TRIP,
  type Place,
  tripDays,
} from "@tritri/shared";
import { ulid } from "ulid";
import type { Deps } from "../context.js";
import { failedConditionIndex, retryOnConflict, type TransactItem } from "../db/errors.js";
import { keys } from "../db/table.js";
import { getTripMeta } from "./trips.js";

export interface Item {
  itemId: string;
  day: number;
  order: string;
  time: string;
  title: string;
  place: Place | null;
  memo: string;
  version: number;
  updatedBy: string;
  updatedAt: string;
}

const ITEM_FIELDS = [
  "itemId",
  "day",
  "order",
  "time",
  "title",
  "place",
  "memo",
  "version",
  "updatedBy",
  "updatedAt",
] as const;

export function toItem(record: Record<string, unknown>): Item {
  return Object.fromEntries(ITEM_FIELDS.map((f) => [f, record[f] ?? null])) as unknown as Item;
}

type Failure = { error: "not_found" } | { error: "day_out_of_range" };

/** 指定した日が、旅の日数の範囲にあるか */
export async function checkDay(
  deps: Deps,
  tripId: string,
  day: number | undefined,
): Promise<Failure | undefined> {
  const meta = await getTripMeta(deps, tripId);
  if (!meta) return { error: "not_found" };
  if (day !== undefined && day > tripDays(meta.startDate as string, meta.endDate as string)) {
    return { error: "day_out_of_range" };
  }
  return undefined;
}

async function getItem(deps: Deps, tripId: string, itemId: string): Promise<Item | undefined> {
  const res = await deps.db.send(
    new GetCommand({
      TableName: deps.tableName,
      Key: keys.item(tripId, itemId),
      ConsistentRead: true,
    }),
  );
  return res.Item ? toItem(res.Item) : undefined;
}

/** 書き込みの条件に合わなかったとき: 無ければ not_found、あれば今の内容を添えて conflict */
async function conflictOrNotFound(deps: Deps, tripId: string, itemId: string) {
  const current = await getItem(deps, tripId, itemId);
  return current ? ({ error: "conflict", current } as const) : ({ error: "not_found" } as const);
}

/** 新しい予定の値を作る */
export function newItem(
  deps: Deps,
  userId: string,
  input: Omit<Item, "itemId" | "version" | "updatedBy" | "updatedAt">,
): Item {
  return {
    itemId: ulid(),
    ...input,
    version: 1,
    updatedBy: userId,
    updatedAt: deps.now().toISOString(),
  };
}

/**
 * 予定を作る書き込み 2 つ(予定を作る・旅の予定の件数を数えて上限を守る)。
 * 候補の採用など、ほかのトランザクションにも組み込めるように分けている。
 */
export function itemCreateWrites(deps: Deps, tripId: string, item: Item): TransactItem[] {
  return [
    {
      Put: {
        TableName: deps.tableName,
        Item: { ...keys.item(tripId, item.itemId), type: "item", ...item },
        ConditionExpression: "attribute_not_exists(PK)",
      },
    },
    {
      Update: {
        TableName: deps.tableName,
        Key: keys.tripMeta(tripId),
        UpdateExpression: "SET itemCount = if_not_exists(itemCount, :zero) + :one",
        ConditionExpression:
          "attribute_exists(PK) AND (attribute_not_exists(itemCount) OR itemCount < :max)",
        ExpressionAttributeValues: { ":zero": 0, ":one": 1, ":max": MAX_ITEMS_PER_TRIP },
      },
    },
  ];
}

/** A6: 予定の追加。旅の予定の件数(itemCount)を同じトランザクションで数え、上限を守る */
export async function createItem(
  deps: Deps,
  tripId: string,
  userId: string,
  input: ItemCreate,
): Promise<{ item: Item } | Failure | { error: "too_many" }> {
  const failure = await checkDay(deps, tripId, input.day);
  if (failure) return failure;

  const item = newItem(deps, userId, input);
  try {
    await retryOnConflict(() =>
      deps.db.send(
        new TransactWriteCommand({ TransactItems: itemCreateWrites(deps, tripId, item) }),
      ),
    );
    return { item };
  } catch (error) {
    if (failedConditionIndex(error) === 1) return { error: "too_many" };
    throw error;
  }
}

/**
 * A7: 予定の更新・並べ替え(楽観ロック)。
 * 読んだときの version のままなら書き込み、version を 1 増やす。
 * ほかの人が先に変えていたら、書き込まずに今の内容を返す(画面で「どちらにするか」を選ばせる)。
 */
export async function updateItem(
  deps: Deps,
  tripId: string,
  itemId: string,
  userId: string,
  patch: ItemPatch,
): Promise<{ item: Item } | Failure | { error: "conflict"; current: Item }> {
  const failure = await checkDay(deps, tripId, patch.day);
  if (failure) return failure;

  const { version, ...changes } = patch;
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {
    ":expected": version,
    ":one": 1,
    ":by": userId,
    ":at": deps.now().toISOString(),
  };
  const sets = ["version = version + :one", "updatedBy = :by", "updatedAt = :at"];
  for (const [field, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    names[`#${field}`] = field; // order など、DynamoDB の予約語でも使えるように
    values[`:${field}`] = value;
    sets.push(`#${field} = :${field}`);
  }

  try {
    const res = await deps.db.send(
      new UpdateCommand({
        TableName: deps.tableName,
        Key: keys.item(tripId, itemId),
        UpdateExpression: `SET ${sets.join(", ")}`,
        ConditionExpression: "attribute_exists(PK) AND version = :expected",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      }),
    );
    return { item: toItem(res.Attributes ?? {}) };
  } catch (error) {
    if (!(error instanceof ConditionalCheckFailedException)) throw error;
    return conflictOrNotFound(deps, tripId, itemId);
  }
}

/** A8: 予定の削除(楽観ロック)。件数も同じトランザクションで減らす */
export async function deleteItem(
  deps: Deps,
  tripId: string,
  itemId: string,
  version: number,
): Promise<{ deleted: true } | { error: "not_found" } | { error: "conflict"; current: Item }> {
  try {
    await retryOnConflict(() =>
      deps.db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Delete: {
                TableName: deps.tableName,
                Key: keys.item(tripId, itemId),
                ConditionExpression: "attribute_exists(PK) AND version = :expected",
                ExpressionAttributeValues: { ":expected": version },
              },
            },
            {
              Update: {
                TableName: deps.tableName,
                Key: keys.tripMeta(tripId),
                UpdateExpression: "SET itemCount = itemCount - :one",
                // 旅が消えていたら書かない(消えた旅の META を作り直さないように)
                ConditionExpression: "attribute_exists(PK)",
                ExpressionAttributeValues: { ":one": 1 },
              },
            },
          ],
        }),
      ),
    );
    return { deleted: true };
  } catch (error) {
    if (failedConditionIndex(error) === 0) return conflictOrNotFound(deps, tripId, itemId);
    throw error;
  }
}
