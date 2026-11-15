import { PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { Deps } from "../context.js";
import { GSI1, keys } from "../db/table.js";
import { rejectJoin } from "./invites.js";
import { propagateDisplayName, transferOwner } from "./manage.js";
import { toMember } from "./trips.js";

/** 退会した人の表示名 */
export const WITHDRAWN_NAME = "退会した会員";

/**
 * A17: 退会。
 * - 未処理の参加申請を消す
 * - オーナーの旅は、いちばん早く参加したメンバーに引き継ぐ(自分 1 人だけの旅はそのまま残す)
 * - 参加していた旅での名前を「退会した会員」にする(支出・コメントなどの記録は残す)
 * - プロフィールに退会日時を入れる
 * Cognito のユーザーの削除は、AWS につなぐ段階で足す。
 */
export async function withdraw(deps: Deps, userId: string): Promise<void> {
  const res = await deps.db.send(
    new QueryCommand({
      TableName: deps.tableName,
      IndexName: GSI1,
      KeyConditionExpression: "GSI1PK = :pk",
      ExpressionAttributeValues: { ":pk": keys.userPk(userId) },
    }),
  );
  const records = res.Items ?? [];

  for (const r of records.filter((x) => String(x.GSI1SK).startsWith("JOINREQ#"))) {
    await rejectJoin(deps, r.tripId as string, userId);
  }

  for (const r of records.filter((x) => String(x.GSI1SK).startsWith("TRIP#"))) {
    if (r.role !== "owner") continue;
    const tripId = r.tripId as string;
    const members = await deps.db.send(
      new QueryCommand({
        TableName: deps.tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: { ":pk": keys.tripPk(tripId), ":prefix": "MEMBER#" },
        ConsistentRead: true,
      }),
    );
    const next = (members.Items ?? [])
      .map(toMember)
      .filter((m) => m.userId !== userId)
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))[0];
    if (next) await transferOwner(deps, tripId, toMember(r), next.userId);
  }

  await propagateDisplayName(deps, userId, WITHDRAWN_NAME);
  await deps.db.send(
    new PutCommand({
      TableName: deps.tableName,
      Item: {
        ...keys.profile(userId),
        displayName: WITHDRAWN_NAME,
        deletedAt: deps.now().toISOString(),
      },
    }),
  );
}
