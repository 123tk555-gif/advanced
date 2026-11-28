import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Context } from "hono";
import type { Notifier } from "./realtime/types.js";
import type { Member } from "./repo/trips.js";

/** API が外から受け取るもの(テストと本番で差し替える) */
export interface Deps {
  db: DynamoDBDocumentClient;
  tableName: string;
  /** ログイン中の利用者の ID を返す。ログインしていなければ undefined */
  resolveUserId: (c: Context) => string | undefined;
  /** 今の時刻(テストでは時計を進められるようにする) */
  now: () => Date;
  /** 変更の通知先(WebSocket) */
  realtime: Notifier;
  /**
   * 応答の後でよい処理(大きな旅の後片付けなど)。手元の開発用サーバーは待たずに応答し、
   * Lambda は応答の後に動けないので待ってから応答する(AWS に公開するときに別の仕組みへ移す)
   */
  later: (task: () => Promise<void>) => Promise<void>;
}

export interface AppEnv {
  Variables: {
    userId: string;
    /** `/trips/:tripId` 以下でだけ入る。ミドルウェア memberOnly が確かめた、自分のメンバー情報 */
    member: Member;
  };
}
