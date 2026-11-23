/**
 * 開発用の API サーバー(手元のパソコンだけで動かす)。
 * 本番は lambda.ts(API Gateway + Lambda)。ここは本番には含めない。
 *
 * ログインの代わりに、画面が送る `x-dev-user-id` ヘッダーを利用者の ID として信じる。
 * そのため 127.0.0.1(このパソコンの中)だけで待ち受け、外からはつながらないようにしている。
 * WebSocket(/ws)は、画面の Origin と 1 回限りのチケットを確かめる。
 * 起動: docker compose up -d dynamodb → corepack pnpm --filter @tritri/api dev
 */
import { ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { createApp } from "./app.js";
import { createDocClient } from "./db/client.js";
import { createConnectionsTable, createTable } from "./db/table.js";
import { clearLocalConnections } from "./realtime/connections.js";
import { createLocalSockets, createSocketServer } from "./realtime/local.js";
import { createRealtime } from "./realtime/service.js";

export const DEV_USER_HEADER = "x-dev-user-id";

const endpoint = process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000";
const tableName = process.env.TABLE_NAME ?? "tritri-dev";
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const port = Number(process.env.PORT ?? 8787);
const connectionsTable = `${tableName}-connections`;

const db = createDocClient({ endpoint });

/** テーブルが無ければ作る(DynamoDB Local はコンテナを止めると中身が消えるため) */
async function ensureTable() {
  const tables = await db.send(new ListTablesCommand({}));
  if (!tables.TableNames?.includes(tableName)) {
    await createTable(db, tableName);
    console.log(`テーブル ${tableName} を作りました`);
  }
  if (!tables.TableNames?.includes(connectionsTable)) {
    await createConnectionsTable(db, connectionsTable);
    console.log(`テーブル ${connectionsTable} を作りました`);
  }
}

const now = () => new Date();
const sockets = createLocalSockets();
const realtimeDeps = { db, tableName, connectionsTable, now, sender: sockets.sender };
const realtime = createRealtime(realtimeDeps);
const api = createApp({
  db,
  tableName,
  resolveUserId: (c) => c.req.header(DEV_USER_HEADER) || undefined,
  now,
  realtime,
  // 待たずに応答する。失敗しても応答には影響させず、記録だけ残す
  later: async (task) => {
    task().catch((error) => console.error("後片付けに失敗しました", error));
  },
});

const server = new Hono();
// CORS より前に置く(WebSocket の応答にはヘッダーを足せない。Origin は /ws が自分で確かめる)
sockets.mount(server, { realtime, origin: webOrigin });
// 画面(Nuxt の開発サーバー)からだけ呼べるようにする。本番は API Gateway の CORS 設定で同じことをする
server.use(
  "*",
  cors({
    origin: webOrigin,
    allowHeaders: ["content-type", DEV_USER_HEADER],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    maxAge: 600,
  }),
);
server.route("/", api);

try {
  await ensureTable();
  await clearLocalConnections(realtimeDeps);
} catch {
  console.error(
    `DynamoDB Local(${endpoint})に接続できません。先に docker compose up -d dynamodb を実行してください。`,
  );
  process.exit(1);
}

const { websocket } = createSocketServer();
serve({ fetch: server.fetch, hostname: "127.0.0.1", port, websocket }, (info) => {
  console.log(
    `開発用 API: http://127.0.0.1:${info.port}(テーブル ${tableName}、画面 ${webOrigin})`,
  );
});
