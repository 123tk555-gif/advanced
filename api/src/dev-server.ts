/**
 * 開発用の API サーバー(手元のパソコンだけで動かす)。
 * 本番は lambda.ts(API Gateway + Lambda)。ここは本番には含めない。
 *
 * ログインの代わりに、画面が送る `x-dev-user-id` ヘッダーを利用者の ID として信じる。
 * そのため 127.0.0.1(このパソコンの中)だけで待ち受け、外からはつながらないようにしている。
 * 起動: docker compose up -d dynamodb → corepack pnpm --filter @tritri/api dev
 */
import { ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createApp } from "./app.js";
import { createDocClient } from "./db/client.js";
import { createTable } from "./db/table.js";

export const DEV_USER_HEADER = "x-dev-user-id";

const endpoint = process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8000";
const tableName = process.env.TABLE_NAME ?? "tritri-dev";
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const port = Number(process.env.PORT ?? 8787);

const db = createDocClient({ endpoint });

/** テーブルが無ければ作る(DynamoDB Local はコンテナを止めると中身が消えるため) */
async function ensureTable() {
  const tables = await db.send(new ListTablesCommand({}));
  if (!tables.TableNames?.includes(tableName)) {
    await createTable(db, tableName);
    console.log(`テーブル ${tableName} を作りました`);
  }
}

const api = createApp({
  db,
  tableName,
  resolveUserId: (c) => c.req.header(DEV_USER_HEADER) || undefined,
  now: () => new Date(),
});

const server = new Hono();
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
} catch {
  console.error(
    `DynamoDB Local(${endpoint})に接続できません。先に docker compose up -d dynamodb を実行してください。`,
  );
  process.exit(1);
}

serve({ fetch: server.fetch, hostname: "127.0.0.1", port }, (info) => {
  console.log(
    `開発用 API: http://127.0.0.1:${info.port}(テーブル ${tableName}、画面 ${webOrigin})`,
  );
});
