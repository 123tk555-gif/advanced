import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  GetCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { connectionKeys } from "../db/table.js";
import type { RealtimeDeps } from "./types.js";

/** Connections テーブルの読み書き(docs/データ設計.md) */
export interface Connection {
  connectionId: string;
  tripId: string;
  userId: string;
  lastSeen: number;
  editingItemId: string | null;
}

/** 自動削除までの時間(API Gateway の接続の上限と同じ 2 時間) */
const TTL_SECONDS = 2 * 60 * 60;
const ttlFrom = (ms: number) => Math.floor(ms / 1000) + TTL_SECONDS;

function toConnection(r: Record<string, unknown>): Connection {
  return {
    connectionId: r.connectionId as string,
    tripId: r.tripId as string,
    userId: r.userId as string,
    lastSeen: r.lastSeen as number,
    editingItemId: (r.editingItemId as string | null | undefined) ?? null,
  };
}

export async function addConnection(
  deps: RealtimeDeps,
  connectionId: string,
  tripId: string,
  userId: string,
): Promise<void> {
  const lastSeen = deps.now().getTime();
  const ttl = ttlFrom(lastSeen);
  await deps.db.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: deps.connectionsTable,
            Item: {
              ...connectionKeys.inTrip(tripId, connectionId),
              connectionId,
              tripId,
              userId,
              lastSeen,
              editingItemId: null,
              ttl,
            },
          },
        },
        {
          Put: {
            TableName: deps.connectionsTable,
            Item: { ...connectionKeys.byId(connectionId), tripId, ttl },
          },
        },
      ],
    }),
  );
}

/** 接続 ID から接続を引く(切断・受信のときに旅がわからないため) */
export async function findConnection(
  deps: RealtimeDeps,
  connectionId: string,
): Promise<Connection | undefined> {
  const pointer = await deps.db.send(
    new GetCommand({
      TableName: deps.connectionsTable,
      Key: connectionKeys.byId(connectionId),
      ConsistentRead: true,
    }),
  );
  if (!pointer.Item) return undefined;
  const res = await deps.db.send(
    new GetCommand({
      TableName: deps.connectionsTable,
      Key: connectionKeys.inTrip(pointer.Item.tripId as string, connectionId),
      ConsistentRead: true,
    }),
  );
  return res.Item ? toConnection(res.Item) : undefined;
}

export async function listConnections(deps: RealtimeDeps, tripId: string): Promise<Connection[]> {
  const found: Connection[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await deps.db.send(
      new QueryCommand({
        TableName: deps.connectionsTable,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: { ":pk": connectionKeys.tripPk(tripId), ":prefix": "CONN#" },
        ExclusiveStartKey: startKey,
        ConsistentRead: true,
      }),
    );
    found.push(...(res.Items ?? []).map(toConnection));
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return found;
}

/** 音沙汰があった(editingItemId を渡せば、編集中の予定も書き換える)。もう無ければ false */
export async function touchConnection(
  deps: RealtimeDeps,
  connection: Connection,
  editingItemId?: string | null,
): Promise<boolean> {
  const now = deps.now().getTime();
  const editing = editingItemId !== undefined;
  try {
    await deps.db.send(
      new UpdateCommand({
        TableName: deps.connectionsTable,
        Key: connectionKeys.inTrip(connection.tripId, connection.connectionId),
        UpdateExpression: `SET lastSeen = :now, #ttl = :ttl${editing ? ", editingItemId = :editing" : ""}`,
        // 切った接続を作り直さない
        ConditionExpression: "attribute_exists(PK)",
        ExpressionAttributeNames: { "#ttl": "ttl" },
        ExpressionAttributeValues: {
          ":now": now,
          ":ttl": ttlFrom(now),
          ...(editing ? { ":editing": editingItemId } : {}),
        },
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return false;
    throw error;
  }
}

export async function removeConnection(deps: RealtimeDeps, connection: Connection): Promise<void> {
  const { tripId, connectionId } = connection;
  await Promise.all(
    [connectionKeys.inTrip(tripId, connectionId), connectionKeys.byId(connectionId)].map((Key) =>
      deps.db.send(new DeleteCommand({ TableName: deps.connectionsTable, Key })),
    ),
  );
}

/**
 * 「今見ている人」の知らせの通し番号。
 * 番号を取ってから一覧を読むので、番号の大きい知らせほど新しい状態を映している。
 */
export async function nextSeq(deps: RealtimeDeps, tripId: string): Promise<number> {
  const now = deps.now().getTime();
  const res = await deps.db.send(
    new UpdateCommand({
      TableName: deps.connectionsTable,
      Key: connectionKeys.seq(tripId),
      UpdateExpression: "SET #ttl = :ttl ADD seq :one",
      ExpressionAttributeNames: { "#ttl": "ttl" },
      // つながっている人がいる間に番号が戻らないよう、接続の上限よりずっと長く残す
      ExpressionAttributeValues: { ":one": 1, ":ttl": ttlFrom(now) + 7 * 24 * 60 * 60 },
      ReturnValues: "UPDATED_NEW",
    }),
  );
  return res.Attributes?.seq as number;
}

/**
 * 開発用サーバーの起動時の掃除。前の起動の接続は、もうどれも生きていない。
 * Scan を使うので手元だけで使う。
 */
export async function clearLocalConnections(deps: RealtimeDeps): Promise<void> {
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await deps.db.send(
      new ScanCommand({
        TableName: deps.connectionsTable,
        FilterExpression: "begins_with(SK, :conn)",
        ExpressionAttributeValues: { ":conn": "CONN" },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const { PK, SK } of res.Items ?? []) {
      await deps.db.send(new DeleteCommand({ TableName: deps.connectionsTable, Key: { PK, SK } }));
    }
    startKey = res.LastEvaluatedKey;
  } while (startKey);
}
