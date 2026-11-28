import { createAwsRealtime, readAwsConfig } from "./aws-config.js";
import { createDocClient } from "./db/client.js";
import { handleWebSocketEvent, type WsEvent } from "./realtime/ws-handler.js";

/** 本番の WebSocket の入口(API Gateway WebSocket API → Lambda。$connect・$disconnect・$default) */
const config = readAwsConfig(process.env);
const created = createAwsRealtime(config, createDocClient(), () => new Date());
if (!created) {
  throw new Error("WebSocket の Lambda には CONNECTIONS_TABLE と WS_ENDPOINT が必要です");
}
const realtime = created;

export async function handler(event: WsEvent) {
  try {
    return await handleWebSocketEvent(realtime, config.webOrigin, event);
  } catch (error) {
    console.error("WebSocket の処理に失敗しました", error);
    // $connect で失敗したら断る。ほかは画面の定期的な読み直しで追いつく
    return { statusCode: 500 };
  }
}
