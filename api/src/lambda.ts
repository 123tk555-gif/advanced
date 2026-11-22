import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { handle } from "hono/aws-lambda";
import { createApp } from "./app.js";
import { userIdFromLambdaEvent } from "./auth.js";
import { createDocClient } from "./db/client.js";
import { noRealtime } from "./realtime/types.js";

/** 本番の入口(API Gateway HTTP API → Lambda) */
const tableName = process.env.TABLE_NAME;
if (!tableName) throw new Error("TABLE_NAME が設定されていません");

const app = createApp({
  db: createDocClient(),
  tableName,
  resolveUserId: (c) =>
    userIdFromLambdaEvent((c.env as { event?: APIGatewayProxyEventV2WithJWTAuthorizer }).event),
  now: () => new Date(),
  // API Gateway WebSocket の入口と送信部品は、AWS に公開する段階で作る。それまでは通知しない
  realtime: noRealtime,
});

export const handler = handle(app);
