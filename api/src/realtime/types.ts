import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { ServerMessage } from "@tritri/shared";

/**
 * 接続へ送る部品。通信の方式ごとに差し替える。
 * 手元は local.ts(ws)。API Gateway WebSocket 用は、AWS に公開する段階で作る。
 */
export interface Sender {
  /** 相手がもういなければ "gone"(API Gateway なら 410) */
  send(connectionId: string, message: ServerMessage): Promise<"sent" | "gone">;
  close(connectionId: string): Promise<void>;
}

/** リアルタイム更新の仕組みが外から受け取るもの */
export interface RealtimeDeps {
  db: DynamoDBDocumentClient;
  /** Main テーブル(メンバーの確認に読む) */
  tableName: string;
  connectionsTable: string;
  now: () => Date;
  sender: Sender;
}

/** API(app.ts)から使う分 */
export interface Notifier {
  /** 接続用の 1 回限りのチケット。リアルタイム更新が使えない環境では null */
  issueTicket(tripId: string, userId: string): Promise<string | null>;
  /** 旅が変わった */
  changed(tripId: string): Promise<void>;
  /** 退会した人の接続を切り、残りの人に知らせる */
  withdrawn(tripId: string, userId: string): Promise<void>;
}

/** リアルタイム更新が無い環境用。画面は定期的な読み直しで動く */
export const noRealtime: Notifier = {
  issueTicket: async () => null,
  changed: async () => {},
  withdrawn: async () => {},
};
