import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { handle } from "hono/aws-lambda";
import { createApp } from "./app.js";
import { userIdFromLambdaEvent } from "./auth.js";
import { createDocClient } from "./db/client.js";

/** 本番の入口(API Gateway HTTP API → Lambda) */
const tableName = process.env.TABLE_NAME;
if (!tableName) throw new Error("TABLE_NAME が設定されていません");

const app = createApp({
  db: createDocClient(),
  tableName,
  resolveUserId: (c) =>
    userIdFromLambdaEvent((c.env as { event?: APIGatewayProxyEventV2WithJWTAuthorizer }).event),
  now: () => new Date(),
});

export const handler = handle(app);
