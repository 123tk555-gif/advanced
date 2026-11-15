import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { Deps } from "../context.js";
import { retryOnConflict } from "../db/errors.js";
import { keys } from "../db/table.js";
import { getTripMeta, loadTripPartition, newToken } from "./trips.js";

/**
 * 公開しおりのリンクの発行し直し("new")・停止(null)。
 * 古いリンクは同じトランザクションで消すので、すぐ使えなくなる。
 */
export async function replacePublicLink(
  deps: Deps,
  tripId: string,
  next: "new" | null,
): Promise<{ token: string } | null> {
  return retryOnConflict(async () => {
    const meta = await getTripMeta(deps, tripId);
    if (!meta) throw new Error(`trip not found: ${tripId}`);
    const old = typeof meta.publicToken === "string" ? meta.publicToken : null;
    const token = next === "new" ? newToken() : null;

    const items: NonNullable<
      ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"]
    > = [];
    if (old) items.push({ Delete: { TableName: deps.tableName, Key: keys.publicLink(old) } });
    if (token) {
      items.push({
        Put: {
          TableName: deps.tableName,
          Item: { ...keys.publicLink(token), type: "public", tripId },
          ConditionExpression: "attribute_not_exists(PK)",
        },
      });
    }
    items.push({
      Update: {
        TableName: deps.tableName,
        Key: keys.tripMeta(tripId),
        ...(token
          ? {
              UpdateExpression: "SET publicToken = :token",
              ExpressionAttributeValues: { ":token": token, ...(old ? { ":old": old } : {}) },
            }
          : {
              UpdateExpression: "REMOVE publicToken",
              ...(old ? { ExpressionAttributeValues: { ":old": old } } : {}),
            }),
        // 読んだときからリンクが変わっていないこと
        ConditionExpression: old ? "publicToken = :old" : "attribute_not_exists(publicToken)",
      },
    });
    await deps.db.send(new TransactWriteCommand({ TransactItems: items }));
    return token ? { token } : null;
  });
}

/**
 * A13: 公開しおり(ログイン不要)。
 * 見せるのは旅の基本情報・メンバーの表示名・予定だけ。利用者の ID や、割り勘・コメント・候補・招待は返さない。
 */
export async function getPublicView(deps: Deps, token: string) {
  const link = await deps.db.send(
    new GetCommand({
      TableName: deps.tableName,
      Key: keys.publicLink(token),
      ConsistentRead: true,
    }),
  );
  if (!link.Item) return undefined;
  const { meta, members, items } = await loadTripPartition(deps, link.Item.tripId as string);
  // 発行し直し・停止と同時に読んだときの念のための確認(META の今のトークンと一致すること)
  if (!meta || meta.publicToken !== token) return undefined;
  return {
    trip: {
      title: meta.title as string,
      startDate: meta.startDate as string,
      endDate: meta.endDate as string,
      destination: meta.destination as string,
    },
    members: members.map((m) => ({ displayName: m.displayName })),
    items: items.map(({ itemId, day, order, time, title, place, memo }) => ({
      itemId,
      day,
      order,
      time,
      title,
      place,
      memo,
    })),
  };
}
