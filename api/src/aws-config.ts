import { ApiGatewayManagementApiClient } from "@aws-sdk/client-apigatewaymanagementapi";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createApiGatewaySender } from "./realtime/apigw.js";
import { createRealtime, type Realtime } from "./realtime/service.js";

/** 本番(Lambda)の設定。CDK が環境変数で渡す */
export interface AwsConfig {
  tableName: string;
  /** 画面の場所(WebSocket の Origin の確認に使う) */
  webOrigin: string;
  /** リアルタイム更新(どちらの値も無ければ null) */
  realtime: { connectionsTable: string; wsEndpoint: string } | null;
}

export function readAwsConfig(env: Record<string, string | undefined>): AwsConfig {
  const need = (name: string) => {
    const value = env[name];
    if (!value) throw new Error(`${name} が設定されていません`);
    return value;
  };
  const tableName = need("TABLE_NAME");
  const webOrigin = need("WEB_ORIGIN");
  const connectionsTable = env.CONNECTIONS_TABLE;
  const wsEndpoint = env.WS_ENDPOINT;
  if (!connectionsTable && !wsEndpoint) return { tableName, webOrigin, realtime: null };
  if (!connectionsTable || !wsEndpoint) {
    throw new Error("CONNECTIONS_TABLE と WS_ENDPOINT は、両方とも設定してください");
  }
  if (!/^https:\/\//.test(wsEndpoint)) {
    throw new Error("WS_ENDPOINT は https:// で始まる管理用の URL にしてください");
  }
  return { tableName, webOrigin, realtime: { connectionsTable, wsEndpoint } };
}

/** 設定から、本番のリアルタイム更新の仕組みを作る(設定が無ければ null) */
export function createAwsRealtime(
  config: AwsConfig,
  db: DynamoDBDocumentClient,
  now: () => Date,
): Realtime | null {
  if (!config.realtime) return null;
  const client = new ApiGatewayManagementApiClient({ endpoint: config.realtime.wsEndpoint });
  return createRealtime({
    db,
    tableName: config.tableName,
    connectionsTable: config.realtime.connectionsTable,
    now,
    sender: createApiGatewaySender(client),
  });
}
