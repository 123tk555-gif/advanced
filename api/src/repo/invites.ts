import { GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { MAX_MEMBERS, MAX_PENDING_JOIN_REQUESTS } from "@tritri/shared";
import type { Deps } from "../context.js";
import { failedConditionIndex, retryOnConflict, retryWhenChanged } from "../db/errors.js";
import { keys } from "../db/table.js";
import type { Profile } from "./profiles.js";
import {
  batchGet,
  getTripMeta,
  type Invite,
  inviteItem,
  newInvite,
  toInvite,
  toMember,
} from "./trips.js";

/** 招待リンクから旅の ID を引く。期限切れ・停止・発行し直す前・存在しない、はどれも undefined */
export async function findTripIdByInvite(deps: Deps, token: string): Promise<string | undefined> {
  const res = await deps.db.send(
    new GetCommand({ TableName: deps.tableName, Key: keys.invite(token), ConsistentRead: true }),
  );
  const item = res.Item;
  if (!item) return undefined;
  if (String(item.expiresAt) <= deps.now().toISOString()) return undefined;
  return item.tripId as string;
}

export type JoinStatus = "none" | "pending" | "member";

/** A5: 招待リンクの画面に出す内容。旅のタイトル・メンバー数・自分の状態だけ */
export async function getJoinInfo(deps: Deps, tripId: string, userId: string) {
  const items = await batchGet(deps, [
    keys.tripMeta(tripId),
    keys.member(tripId, userId),
    keys.joinRequest(tripId, userId),
  ]);
  const meta = items.find((i) => i.SK === "META");
  if (!meta) return undefined;
  const status: JoinStatus = items.some((i) => String(i.SK).startsWith("MEMBER#"))
    ? "member"
    : items.some((i) => String(i.SK).startsWith("JOINREQ#"))
      ? "pending"
      : "none";
  return {
    trip: { title: meta.title as string, memberCount: meta.memberCount as number },
    status,
    // 旅の ID は、メンバーになった人にだけ返す(画面の移動に使う)
    ...(status === "member" ? { tripId } : {}),
  };
}

/** A5b: 参加申請。すでに申請済みなら "exists"、申請が多すぎれば "full" */
export async function requestJoin(
  deps: Deps,
  tripId: string,
  profile: Profile,
): Promise<"created" | "exists" | "full"> {
  const requestedAt = deps.now().toISOString();
  try {
    await retryOnConflict(() =>
      deps.db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: deps.tableName,
                Item: {
                  ...keys.joinRequest(tripId, profile.userId),
                  ...keys.joinRequestGsi(profile.userId, requestedAt, tripId),
                  type: "joinRequest",
                  tripId,
                  userId: profile.userId,
                  displayName: profile.displayName,
                  requestedAt,
                },
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            {
              Update: {
                TableName: deps.tableName,
                Key: keys.tripMeta(tripId),
                UpdateExpression: "SET joinRequestCount = joinRequestCount + :one",
                ConditionExpression: "attribute_exists(PK) AND joinRequestCount < :max",
                ExpressionAttributeValues: { ":one": 1, ":max": MAX_PENDING_JOIN_REQUESTS },
              },
            },
          ],
        }),
      ),
    );
    return "created";
  } catch (error) {
    const index = failedConditionIndex(error);
    if (index === 0) return "exists";
    if (index === 1) return "full";
    throw error;
  }
}

export interface JoinRequest {
  userId: string;
  displayName: string;
  requestedAt: string;
}

/** A5c: 申請の一覧(古い順) */
export async function listJoinRequests(deps: Deps, tripId: string): Promise<JoinRequest[]> {
  const res = await deps.db.send(
    new QueryCommand({
      TableName: deps.tableName,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": keys.tripPk(tripId), ":prefix": "JOINREQ#" },
      ConsistentRead: true,
    }),
  );
  return (res.Items ?? [])
    .map((i) => ({
      userId: i.userId as string,
      displayName: i.displayName as string,
      requestedAt: i.requestedAt as string,
    }))
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}

/** A5d: 承認。申請を消し、メンバーを作り、人数を増やす(50 人を超えない)を 1 つのトランザクションで */
export async function approveJoin(
  deps: Deps,
  tripId: string,
  userId: string,
): Promise<"approved" | "not_found" | "full"> {
  const req = await deps.db.send(
    new GetCommand({
      TableName: deps.tableName,
      Key: keys.joinRequest(tripId, userId),
      ConsistentRead: true,
    }),
  );
  if (!req.Item) return "not_found";
  const now = deps.now().toISOString();
  const member = toMember({
    userId,
    displayName: req.Item.displayName,
    role: "member",
    joinedAt: now,
  });

  try {
    await retryOnConflict(() =>
      deps.db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Delete: {
                TableName: deps.tableName,
                Key: keys.joinRequest(tripId, userId),
                ConditionExpression: "attribute_exists(PK)",
              },
            },
            {
              Put: {
                TableName: deps.tableName,
                Item: {
                  ...keys.member(tripId, userId),
                  ...keys.memberGsi(userId, now, tripId),
                  type: "member",
                  tripId,
                  ...member,
                },
                // 退会した同じ ID の人が申請し直した場合は、新しいメンバーとして作り直す(手元の開発用ログインだけで起きる)
                ConditionExpression: "attribute_not_exists(PK) OR withdrawn = :yes",
                ExpressionAttributeValues: { ":yes": true },
              },
            },
            {
              Update: {
                TableName: deps.tableName,
                Key: keys.tripMeta(tripId),
                UpdateExpression:
                  "SET memberCount = memberCount + :one, joinRequestCount = joinRequestCount - :one",
                ConditionExpression: "attribute_exists(PK) AND memberCount < :max",
                ExpressionAttributeValues: { ":one": 1, ":max": MAX_MEMBERS },
              },
            },
          ],
        }),
      ),
    );
    return "approved";
  } catch (error) {
    const index = failedConditionIndex(error);
    if (index === 0 || index === 1) return "not_found"; // 別の操作で先に処理された
    if (index === 2) return "full";
    throw error;
  }
}

/** A5e: 却下 */
export async function rejectJoin(
  deps: Deps,
  tripId: string,
  userId: string,
): Promise<"rejected" | "not_found"> {
  try {
    await retryOnConflict(() =>
      deps.db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Delete: {
                TableName: deps.tableName,
                Key: keys.joinRequest(tripId, userId),
                ConditionExpression: "attribute_exists(PK)",
              },
            },
            {
              Update: {
                TableName: deps.tableName,
                Key: keys.tripMeta(tripId),
                UpdateExpression: "SET joinRequestCount = joinRequestCount - :one",
                // 旅が消えていたら書かない(消えた旅の META を作り直さないように)
                ConditionExpression: "attribute_exists(PK)",
                ExpressionAttributeValues: { ":one": 1 },
              },
            },
          ],
        }),
      ),
    );
    return "rejected";
  } catch (error) {
    if (failedConditionIndex(error) === 0) return "not_found";
    throw error;
  }
}

/**
 * A16: 招待リンクの発行し直し(next に新しいリンク)・停止(next が null)。
 * 古いリンクは同じトランザクションで消すので、すぐ使えなくなる。
 */
export async function replaceInvite(
  deps: Deps,
  tripId: string,
  next: "new" | null,
): Promise<Invite | null> {
  return retryWhenChanged(async () => {
    const meta = await getTripMeta(deps, tripId);
    if (!meta) throw new Error(`trip not found: ${tripId}`);
    const old = toInvite(meta);
    const invite = next === "new" ? newInvite(deps.now()) : null;

    const items: NonNullable<
      ConstructorParameters<typeof TransactWriteCommand>[0]["TransactItems"]
    > = [];
    if (old) {
      items.push({ Delete: { TableName: deps.tableName, Key: keys.invite(old.token) } });
    }
    if (invite) {
      items.push({
        Put: {
          TableName: deps.tableName,
          Item: inviteItem(tripId, invite),
          ConditionExpression: "attribute_not_exists(PK)",
        },
      });
    }
    // 読んだときから招待リンクが変わっていないこと(同時に操作されたら、やり直す)
    const unchanged = old ? "inviteToken = :old" : "attribute_not_exists(inviteToken)";
    items.push({
      Update: {
        TableName: deps.tableName,
        Key: keys.tripMeta(tripId),
        ...(invite
          ? {
              UpdateExpression: "SET inviteToken = :token, inviteExpiresAt = :expiresAt",
              ExpressionAttributeValues: {
                ":token": invite.token,
                ":expiresAt": invite.expiresAt,
                ...(old ? { ":old": old.token } : {}),
              },
            }
          : {
              UpdateExpression: "REMOVE inviteToken, inviteExpiresAt",
              ...(old ? { ExpressionAttributeValues: { ":old": old.token } } : {}),
            }),
        ConditionExpression: unchanged,
      },
    });

    await deps.db.send(new TransactWriteCommand({ TransactItems: items }));
    return invite;
  });
}
