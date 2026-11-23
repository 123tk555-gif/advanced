import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { Deps } from "../context.js";
import { GSI1, keys } from "../db/table.js";
import { rejectJoin } from "./invites.js";
import { transferOwner } from "./manage.js";
import { toMember } from "./trips.js";

/** 退会した人の表示名 */
export const WITHDRAWN_NAME = "退会した会員";

/**
 * A17: 退会。
 * - 未処理の参加申請を消す
 * - オーナーの旅は、いちばん早く参加したメンバーに引き継ぐ(自分 1 人だけの旅はそのまま残す)
 * - 参加していた旅での名前を「退会した会員」にし、旅を開けなくする(支出・コメントなどの記録は残す)。
 *   自分の一覧(GSI1)からも外すので、同じ ID で登録し直しても前の旅は見えず、名前も戻らない
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
    // いちばん早く参加した人から順に試す(同時に抜けた人がいれば次の人へ)
    const candidates = (members.Items ?? [])
      .map(toMember)
      .filter((m) => m.userId !== userId && !m.withdrawn)
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
    for (const next of candidates) {
      if ((await transferOwner(deps, tripId, toMember(r), next.userId)) === "transferred") break;
    }
  }

  for (const r of records.filter((x) => String(x.GSI1SK).startsWith("TRIP#"))) {
    try {
      await deps.db.send(
        new UpdateCommand({
          TableName: deps.tableName,
          Key: { PK: r.PK, SK: r.SK },
          UpdateExpression: "SET displayName = :name, withdrawn = :yes REMOVE GSI1PK, GSI1SK",
          // 同時に外された旅の項目を作り直さない
          ConditionExpression: "attribute_exists(PK)",
          ExpressionAttributeValues: { ":name": WITHDRAWN_NAME, ":yes": true },
        }),
      );
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException)) throw error;
    }
  }

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
