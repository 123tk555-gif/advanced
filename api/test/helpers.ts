import { DeleteTableCommand } from "@aws-sdk/client-dynamodb";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll } from "vitest";
import { createApp } from "../src/app.js";
import { createDocClient } from "../src/db/client.js";
import { createConnectionsTable, createTable } from "../src/db/table.js";
import { createRealtime } from "../src/realtime/service.js";
import type { Sender } from "../src/realtime/types.js";
import { recordingSender } from "./realtime-helpers.js";

/** テストでは、ログイン中の利用者をこのヘッダーで指定する(本番は Cognito の JWT から取る) */
export const TEST_USER_HEADER = "x-test-user-id";

/**
 * テストファイルごとに専用のテーブルを作り、そのテーブルを使う API を返す。
 * テストファイル同士が同じデータを触らないようにするため。
 */
export function useTestApi(
  options: { sender?: Sender; later?: (task: () => Promise<void>) => Promise<void> } = {},
) {
  const db = createDocClient({
    endpoint: process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000",
  });
  const tableName = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  /** テストで時計を進められるようにする(招待リンクの期限のテスト用) */
  let offsetMs = 0;
  const clock = {
    advanceDays(days: number) {
      offsetMs += days * 86_400_000;
    },
    advanceSeconds(seconds: number) {
      offsetMs += seconds * 1000;
    },
    reset() {
      offsetMs = 0;
    },
  };
  const now = () => new Date(Date.now() + offsetMs);
  const connectionsTable = `${tableName}-connections`;
  const outbox = recordingSender();
  const realtime = createRealtime({
    db,
    tableName,
    connectionsTable,
    now,
    sender: options.sender ?? outbox.sender,
  });
  const app = createApp({
    db,
    tableName,
    resolveUserId: (c) => c.req.header(TEST_USER_HEADER),
    now,
    realtime,
    // 既定では待ってから応答する(Lambda と同じ)。後で行う動きを試すときは差し替える
    later: options.later ?? ((task) => task()),
  });

  beforeAll(async () => {
    await createTable(db, tableName);
    await createConnectionsTable(db, connectionsTable);
  });
  afterAll(async () => {
    await db.send(new DeleteTableCommand({ TableName: tableName }));
    await db.send(new DeleteTableCommand({ TableName: connectionsTable }));
    db.destroy();
  });

  /** userId としてログインした状態で API を呼ぶ。userId が null ならログインしていない状態 */
  async function call(
    userId: string | null,
    method: string,
    path: string,
    body?: unknown,
    // biome-ignore lint/suspicious/noExplicitAny: テストでは応答の中身を自由に調べたいため
  ): Promise<{ status: number; body: any }> {
    const headers: Record<string, string> = {};
    if (userId) headers[TEST_USER_HEADER] = userId;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await app.request(path, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  /** 表示名を登録した会員を用意する */
  async function signUp(userId: string, displayName = userId) {
    const res = await call(userId, "PUT", "/me", { displayName });
    if (res.status !== 200) throw new Error(`signUp failed: ${res.status}`);
  }

  /** ownerId がオーナーの旅を作り、tripId と招待トークンを返す */
  async function createTrip(ownerId: string, change: Partial<typeof validTrip> = {}) {
    const res = await call(ownerId, "POST", "/trips", { ...validTrip, ...change });
    if (res.status !== 201) throw new Error(`createTrip failed: ${res.status}`);
    return { tripId: res.body.trip.tripId as string, inviteToken: res.body.invite.token as string };
  }

  /** userId を、招待リンクからの申請 → オーナーの承認で、旅のメンバーにする */
  async function addMember(
    trip: { tripId: string; inviteToken: string },
    ownerId: string,
    userId: string,
  ) {
    await signUp(userId);
    const req = await call(userId, "POST", `/join/${trip.inviteToken}`);
    if (req.status !== 201) throw new Error(`join request failed: ${req.status}`);
    const ok = await call(ownerId, "POST", `/trips/${trip.tripId}/join-requests/${userId}/approve`);
    if (ok.status !== 200) throw new Error(`approve failed: ${ok.status}`);
  }

  /** テスト用: 旅のデータのうち、SK が prefix で始まる項目の数(API からは見えない後片付けの確認用) */
  async function countRecords(tripId: string, prefix: string) {
    const res = await db.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: prefix ? "PK = :pk AND begins_with(SK, :prefix)" : "PK = :pk",
        ExpressionAttributeValues: {
          ":pk": `TRIP#${tripId}`,
          ...(prefix ? { ":prefix": prefix } : {}),
        },
        Select: "COUNT",
        ConsistentRead: true,
      }),
    );
    return res.Count ?? 0;
  }

  /** テスト用: その旅につながっている接続の数 */
  async function countConnections(tripId: string) {
    const res = await db.send(
      new QueryCommand({
        TableName: connectionsTable,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: { ":pk": `TRIP#${tripId}`, ":prefix": "CONN#" },
        Select: "COUNT",
        ConsistentRead: true,
      }),
    );
    return res.Count ?? 0;
  }

  return {
    app,
    db,
    tableName,
    call,
    signUp,
    createTrip,
    addMember,
    clock,
    countRecords,
    countConnections,
    realtime,
    outbox,
  };
}

/** 正しい旅の作成内容(テストで一部だけ変えて使う) */
export const validTrip = {
  title: "京都 2 泊 3 日",
  startDate: "2027-04-01",
  endDate: "2027-04-03",
  destination: "京都",
};
