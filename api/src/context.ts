import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Context } from "hono";
import type { Member } from "./repo/trips.js";

/** API が外から受け取るもの(テストと本番で差し替える) */
export interface Deps {
  db: DynamoDBDocumentClient;
  tableName: string;
  /** ログイン中の利用者の ID を返す。ログインしていなければ undefined */
  resolveUserId: (c: Context) => string | undefined;
  /** 今の時刻(テストでは時計を進められるようにする) */
  now: () => Date;
}

export interface AppEnv {
  Variables: {
    userId: string;
    /** `/trips/:tripId` 以下でだけ入る。ミドルウェア memberOnly が確かめた、自分のメンバー情報 */
    member: Member;
  };
}
