import { randomBytes } from "node:crypto";
import {
  BatchGetCommand,
  type BatchGetCommandOutput,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  compareOrderKey,
  INVITE_VALID_DAYS,
  settle,
  type Transfer,
  type TripInput,
} from "@tritri/shared";
import { ulid } from "ulid";
import type { Deps } from "../context.js";
import { GSI1, keys } from "../db/table.js";
import { type Comment, groupComments } from "./comments.js";
import { type Expense, toExpense } from "./expenses.js";
import { buildIdeas, type Idea } from "./ideas.js";
import { type Item, toItem } from "./items.js";

export type Role = "owner" | "member";

/** メンバーに見せる旅の情報(招待リンクは含めない。必要な画面でだけ Invite として別に返す) */
export interface Trip {
  tripId: string;
  title: string;
  startDate: string;
  endDate: string;
  destination: string;
  ownerId: string;
  memberCount: number;
  createdAt: string;
}

export interface Invite {
  token: string;
  expiresAt: string;
}

export interface Member {
  userId: string;
  displayName: string;
  role: Role;
  joinedAt: string;
}

const TRIP_FIELDS = [
  "tripId",
  "title",
  "startDate",
  "endDate",
  "destination",
  "ownerId",
  "memberCount",
  "createdAt",
] as const;

/** 保存している項目のうち、Trip に決めた項目だけを取り出す(内部の項目を応答に漏らさない) */
export function toTrip(item: Record<string, unknown>): Trip {
  return Object.fromEntries(TRIP_FIELDS.map((f) => [f, item[f]])) as unknown as Trip;
}

export function toInvite(meta: Record<string, unknown>): Invite | null {
  return typeof meta.inviteToken === "string"
    ? { token: meta.inviteToken, expiresAt: meta.inviteExpiresAt as string }
    : null;
}

export function toMember(item: Record<string, unknown>): Member {
  return {
    userId: item.userId as string,
    displayName: item.displayName as string,
    role: item.role as Role,
    joinedAt: item.joinedAt as string,
  };
}

/** 推測されにくい URL 用のトークン(256 ビット) */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** 招待リンクを新しく作る(期限は今から INVITE_VALID_DAYS 日) */
export function newInvite(now: Date): Invite {
  return {
    token: newToken(),
    expiresAt: new Date(now.getTime() + INVITE_VALID_DAYS * 86_400_000).toISOString(),
  };
}

/** INVITE の項目。ttl は DynamoDB の自動削除用(削除は遅れるので、期限はコードでも確かめる) */
export function inviteItem(tripId: string, invite: Invite) {
  return {
    ...keys.invite(invite.token),
    type: "invite",
    tripId,
    expiresAt: invite.expiresAt,
    ttl: Math.floor(Date.parse(invite.expiresAt) / 1000),
  };
}

/** A2: 旅の作成。META・オーナーの MEMBER・INVITE をまとめて書く */
export async function createTrip(
  deps: Deps,
  owner: { userId: string; displayName: string },
  input: TripInput,
): Promise<{ trip: Trip; invite: Invite }> {
  const nowDate = deps.now();
  const now = nowDate.toISOString();
  const trip: Trip = {
    tripId: ulid(),
    title: input.title,
    startDate: input.startDate,
    endDate: input.endDate,
    destination: input.destination,
    ownerId: owner.userId,
    memberCount: 1,
    createdAt: now,
  };
  const invite = newInvite(nowDate);
  const member: Member = {
    userId: owner.userId,
    displayName: owner.displayName,
    role: "owner",
    joinedAt: now,
  };
  const notExists = "attribute_not_exists(PK)";
  await deps.db.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: deps.tableName,
            Item: {
              ...keys.tripMeta(trip.tripId),
              type: "trip",
              ...trip,
              joinRequestCount: 0,
              inviteToken: invite.token,
              inviteExpiresAt: invite.expiresAt,
            },
            ConditionExpression: notExists,
          },
        },
        {
          Put: {
            TableName: deps.tableName,
            Item: {
              ...keys.member(trip.tripId, owner.userId),
              ...keys.memberGsi(owner.userId, now, trip.tripId),
              type: "member",
              tripId: trip.tripId,
              ...member,
            },
            ConditionExpression: notExists,
          },
        },
        {
          Put: {
            TableName: deps.tableName,
            Item: inviteItem(trip.tripId, invite),
            ConditionExpression: notExists,
          },
        },
      ],
    }),
  );
  return { trip, invite };
}

export interface MyTrip extends Trip {
  role: Role;
}

/** A1: 自分の旅の一覧(開始日の早い順) */
export async function listMyTrips(deps: Deps, userId: string): Promise<MyTrip[]> {
  const memberships: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await deps.db.send(
      new QueryCommand({
        TableName: deps.tableName,
        IndexName: GSI1,
        // GSI1 には参加申請(JOINREQ#…)も入っているので、メンバー(TRIP#…)だけを取る
        KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :trip)",
        ExpressionAttributeValues: { ":pk": keys.userPk(userId), ":trip": "TRIP#" },
        ExclusiveStartKey: startKey,
      }),
    );
    memberships.push(...(res.Items ?? []));
    startKey = res.LastEvaluatedKey;
  } while (startKey);

  const roles = new Map(memberships.map((m) => [m.tripId as string, m.role as Role]));
  const metas = await batchGet(
    deps,
    [...roles.keys()].map((id) => keys.tripMeta(id)),
  );
  return metas
    .map((meta) => ({ ...toTrip(meta), role: roles.get(meta.tripId as string) as Role }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.tripId.localeCompare(b.tripId));
}

/** BatchGet を 100 件ずつ、処理されなかった分はやり直して、すべて取る */
export async function batchGet(deps: Deps, keyList: Record<string, unknown>[]) {
  const items: Record<string, unknown>[] = [];
  for (let i = 0; i < keyList.length; i += 100) {
    let requestKeys: Record<string, unknown>[] | undefined = keyList.slice(i, i + 100);
    while (requestKeys && requestKeys.length > 0) {
      const res: BatchGetCommandOutput = await deps.db.send(
        new BatchGetCommand({ RequestItems: { [deps.tableName]: { Keys: requestKeys } } }),
      );
      items.push(...(res.Responses?.[deps.tableName] ?? []));
      requestKeys = res.UnprocessedKeys?.[deps.tableName]?.Keys;
    }
  }
  return items;
}

/** A4: その旅のメンバーなら、メンバー情報を返す */
export async function getMember(
  deps: Deps,
  tripId: string,
  userId: string,
): Promise<Member | undefined> {
  const res = await deps.db.send(
    new GetCommand({ TableName: deps.tableName, Key: keys.member(tripId, userId) }),
  );
  return res.Item ? toMember(res.Item) : undefined;
}

export async function getTripMeta(
  deps: Deps,
  tripId: string,
): Promise<Record<string, unknown> | undefined> {
  const res = await deps.db.send(
    new GetCommand({ TableName: deps.tableName, Key: keys.tripMeta(tripId), ConsistentRead: true }),
  );
  return res.Item;
}

export interface TripView {
  trip: Trip;
  members: Member[];
  /** 予定(コメントつき)。日にち → 並び順の順 */
  items: (Item & { comments: Comment[] })[];
  /** 行きたい場所の候補。票の多い順 */
  ideas: Idea[];
  /** 支出(新しい順)と、精算(誰が誰にいくら) */
  expenses: Expense[];
  settlement: Transfer[];
  myRole: Role;
  invite: Invite | null;
  /** 公開しおりのリンク。公開していなければ null */
  public: { token: string } | null;
}

/** 旅のデータ(PK = TRIP#<id> の項目すべて)を 1 回の Query で取り、種類ごとに分ける */
export async function loadTripPartition(deps: Deps, tripId: string) {
  const records: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await deps.db.send(
      new QueryCommand({
        TableName: deps.tableName,
        KeyConditionExpression: "PK = :pk",
        ExpressionAttributeValues: { ":pk": keys.tripPk(tripId) },
        ExclusiveStartKey: startKey,
      }),
    );
    records.push(...(res.Items ?? []));
    startKey = res.LastEvaluatedKey;
  } while (startKey);

  const of = (prefix: string) => records.filter((r) => String(r.SK).startsWith(prefix));
  return {
    meta: records.find((r) => r.SK === "META"),
    members: of("MEMBER#")
      .map(toMember)
      .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt)),
    items: of("ITEM#")
      .map(toItem)
      .sort(
        (a, b) =>
          a.day - b.day || compareOrderKey(a.order, b.order) || compareOrderKey(a.itemId, b.itemId),
      ),
    of,
  };
}

/**
 * A3: 旅の画面のデータ。1 回の Query で旅のデータをまとめて取る。
 * メンバーかどうかは、呼ぶ前にミドルウェア memberOnly が確かめている。
 */
export async function getTripView(
  deps: Deps,
  tripId: string,
  me: Member,
): Promise<TripView | undefined> {
  const { meta, members, items, of } = await loadTripPartition(deps, tripId);
  if (!meta) return undefined;
  // コメントは予定ごとに付ける(消えた予定のコメントが残っていても出さない)
  const comments = groupComments(of("CMT#"), members);
  // 支出は新しい順。精算には、抜けたメンバーの支出も含める
  const expenses = of("EXP#")
    .map(toExpense)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    trip: toTrip(meta),
    members,
    items: items.map((i) => ({ ...i, comments: comments.get(i.itemId) ?? [] })),
    ideas: buildIdeas(of("IDEA#"), of("VOTE#"), me.userId),
    expenses,
    settlement: settle(expenses),
    myRole: me.role,
    invite: toInvite(meta),
    public: typeof meta.publicToken === "string" ? { token: meta.publicToken } : null,
  };
}

/** 申請中(オーナーの承認待ち)の旅。見せるのはタイトルと申請日時だけ */
export async function listMyPendingTrips(
  deps: Deps,
  userId: string,
): Promise<{ title: string; requestedAt: string }[]> {
  const res = await deps.db.send(
    new QueryCommand({
      TableName: deps.tableName,
      IndexName: GSI1,
      KeyConditionExpression: "GSI1PK = :pk AND begins_with(GSI1SK, :req)",
      ExpressionAttributeValues: { ":pk": keys.userPk(userId), ":req": "JOINREQ#" },
    }),
  );
  const requests = res.Items ?? [];
  const metas = await batchGet(
    deps,
    requests.map((r) => keys.tripMeta(r.tripId as string)),
  );
  const titles = new Map(metas.map((m) => [m.tripId as string, m.title as string]));
  return requests
    .filter((r) => titles.has(r.tripId as string))
    .map((r) => ({
      title: titles.get(r.tripId as string) as string,
      requestedAt: r.requestedAt as string,
    }))
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
}
