import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { type TripInput, tripDays } from "@tritri/shared";
import type { Deps } from "../context.js";
import { deleteAll, queryKeys } from "../db/batch.js";
import { failedConditionIndex, retryOnConflict } from "../db/errors.js";
import { GSI1, keys } from "../db/table.js";
import { getTripMeta, type Member, type Trip, toTrip } from "./trips.js";

/** 旅の情報の変更(オーナー)。予定がある日より短くはできない */
export async function updateTrip(
  deps: Deps,
  tripId: string,
  input: TripInput,
): Promise<{ trip: Trip } | { error: "items_out_of_range" | "not_found" }> {
  const res = await deps.db.send(
    new QueryCommand({
      TableName: deps.tableName,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": keys.tripPk(tripId), ":prefix": "ITEM#" },
      ProjectionExpression: "#day",
      ExpressionAttributeNames: { "#day": "day" },
      ConsistentRead: true,
    }),
  );
  const lastDay = Math.max(0, ...(res.Items ?? []).map((i) => i.day as number));
  if (lastDay > tripDays(input.startDate, input.endDate)) return { error: "items_out_of_range" };

  try {
    const updated = await deps.db.send(
      new UpdateCommand({
        TableName: deps.tableName,
        Key: keys.tripMeta(tripId),
        UpdateExpression:
          "SET title = :title, startDate = :start, endDate = :end, destination = :dest",
        ConditionExpression: "attribute_exists(PK)",
        ExpressionAttributeValues: {
          ":title": input.title,
          ":start": input.startDate,
          ":end": input.endDate,
          ":dest": input.destination,
        },
        ReturnValues: "ALL_NEW",
      }),
    );
    return { trip: toTrip(updated.Attributes ?? {}) };
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return { error: "not_found" };
    throw error;
  }
}

/**
 * メンバーの削除(外す・抜ける)。オーナーは消さない(先に引き継ぐ)。
 * その人の支出・投票・コメントは残す(精算が合わなくならないように)。
 */
export async function removeMember(
  deps: Deps,
  tripId: string,
  userId: string,
): Promise<"removed" | "not_found"> {
  try {
    await retryOnConflict(() =>
      deps.db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Delete: {
                TableName: deps.tableName,
                Key: keys.member(tripId, userId),
                ConditionExpression: "attribute_exists(PK) AND #role = :member",
                ExpressionAttributeNames: { "#role": "role" },
                ExpressionAttributeValues: { ":member": "member" },
              },
            },
            {
              Update: {
                TableName: deps.tableName,
                Key: keys.tripMeta(tripId),
                UpdateExpression: "SET memberCount = memberCount - :one",
                ConditionExpression: "attribute_exists(PK)",
                ExpressionAttributeValues: { ":one": 1 },
              },
            },
          ],
        }),
      ),
    );
    return "removed";
  } catch (error) {
    if (failedConditionIndex(error) === 0) return "not_found";
    throw error;
  }
}

/** オーナーの引き継ぎ。相手をオーナーに、自分をメンバーに、旅の ownerId を相手に(すべて同時に) */
export async function transferOwner(
  deps: Deps,
  tripId: string,
  me: Member,
  toUserId: string,
): Promise<"transferred" | "not_found" | "conflict"> {
  const role = { "#role": "role" };
  try {
    await retryOnConflict(() =>
      deps.db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: deps.tableName,
                Key: keys.member(tripId, toUserId),
                UpdateExpression: "SET #role = :owner",
                ConditionExpression: "attribute_exists(PK) AND #role = :member",
                ExpressionAttributeNames: role,
                ExpressionAttributeValues: { ":owner": "owner", ":member": "member" },
              },
            },
            {
              Update: {
                TableName: deps.tableName,
                Key: keys.member(tripId, me.userId),
                UpdateExpression: "SET #role = :member",
                ConditionExpression: "#role = :owner",
                ExpressionAttributeNames: role,
                ExpressionAttributeValues: { ":owner": "owner", ":member": "member" },
              },
            },
            {
              Update: {
                TableName: deps.tableName,
                Key: keys.tripMeta(tripId),
                UpdateExpression: "SET ownerId = :to",
                ConditionExpression: "ownerId = :me",
                ExpressionAttributeValues: { ":to": toUserId, ":me": me.userId },
              },
            },
          ],
        }),
      ),
    );
    return "transferred";
  } catch (error) {
    const index = failedConditionIndex(error);
    if (index === 0) return "not_found";
    if (index === 1 || index === 2) return "conflict"; // 同時にほかの引き継ぎが行われた
    throw error;
  }
}

/**
 * 旅の削除(オーナー)。META を先に消して、すぐに誰も開けない状態にする。
 * 残りの項目・招待リンク・公開リンクは、その後にまとめて消す。
 */
export async function deleteTrip(
  deps: Deps,
  tripId: string,
  me: Member,
): Promise<"deleted" | "conflict"> {
  const meta = await getTripMeta(deps, tripId);
  if (!meta) return "deleted";
  try {
    await deps.db.send(
      new DeleteCommand({
        TableName: deps.tableName,
        Key: keys.tripMeta(tripId),
        ConditionExpression: "ownerId = :me",
        ExpressionAttributeValues: { ":me": me.userId },
      }),
    );
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return "conflict";
    throw error;
  }
  const links: Record<string, unknown>[] = [];
  if (typeof meta.inviteToken === "string") links.push(keys.invite(meta.inviteToken));
  if (typeof meta.publicToken === "string") links.push(keys.publicLink(meta.publicToken));
  await deleteAll(deps, links);
  await deleteAll(deps, await queryKeys(deps, keys.tripPk(tripId), ""));
  return "deleted";
}

/** 表示名を変えたとき、参加中の旅のメンバー情報と、申請中の参加申請の表示名も書き換える */
export async function propagateDisplayName(
  deps: Deps,
  userId: string,
  displayName: string,
): Promise<void> {
  const res = await deps.db.send(
    new QueryCommand({
      TableName: deps.tableName,
      IndexName: GSI1,
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": keys.userPk(userId) },
      ProjectionExpression: "PK, SK",
    }),
  );
  for (const key of res.Items ?? []) {
    try {
      await deps.db.send(
        new UpdateCommand({
          TableName: deps.tableName,
          Key: { PK: key.PK, SK: key.SK },
          UpdateExpression: "SET displayName = :name",
          // 抜けた・承認された直後で、もう無い項目は作り直さない
          ConditionExpression: "attribute_exists(PK)",
          ExpressionAttributeValues: { ":name": displayName },
        }),
      );
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) throw error;
    }
  }
}
