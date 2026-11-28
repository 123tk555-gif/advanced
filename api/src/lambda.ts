import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { handle } from "hono/aws-lambda";
import { createApp } from "./app.js";
import { userIdFromLambdaEvent } from "./auth.js";
import { createAwsRealtime, readAwsConfig } from "./aws-config.js";
import { createDocClient } from "./db/client.js";
import { noRealtime } from "./realtime/types.js";

/** 本番の入口(API Gateway HTTP API → Lambda) */
const config = readAwsConfig(process.env);
const db = createDocClient();
const now = () => new Date();

const app = createApp({
  db,
  tableName: config.tableName,
  resolveUserId: (c) =>
    userIdFromLambdaEvent((c.env as { event?: APIGatewayProxyEventV2WithJWTAuthorizer }).event),
  now,
  realtime: createAwsRealtime(config, db, now) ?? noRealtime,
  // Lambda は応答を返すと止まるので、後片付けを待ってから応答する(SQS などへ移すのは今後の課題)
  later: (task) => task(),
});

export const handler = handle(app);
