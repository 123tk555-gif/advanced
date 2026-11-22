import { randomBytes } from "node:crypto";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { connectionKeys } from "../db/table.js";
import type { RealtimeDeps } from "./types.js";

/**
 * WebSocket の接続用チケット。
 * ブラウザの WebSocket はヘッダーを付けられないので、ログインの情報の代わりに URL に付ける。
 * URL は記録に残りうるため、30 秒・1 回限りにする。
 */
const TICKET_VALID_MS = 30_000;
const TICKET_FORMAT = /^[A-Za-z0-9_-]{43}$/;

export async function issueTicket(
  deps: RealtimeDeps,
  tripId: string,
  userId: string,
): Promise<string> {
  const ticket = randomBytes(32).toString("base64url");
  const expiresAt = deps.now().getTime() + TICKET_VALID_MS;
  await deps.db.send(
    new PutCommand({
      TableName: deps.connectionsTable,
      Item: {
        ...connectionKeys.ticket(ticket),
        tripId,
        userId,
        expiresAt,
        // 自動削除は遅れることがあるので、期限は使うときに必ず確かめる
        ttl: Math.ceil(expiresAt / 1000),
      },
    }),
  );
  return ticket;
}

/** チケットを使う。消しながら読むので、同時に使われても受け取れるのは 1 回だけ */
export async function useTicket(
  deps: RealtimeDeps,
  ticket: string,
): Promise<{ tripId: string; userId: string } | undefined> {
  if (!TICKET_FORMAT.test(ticket)) return undefined;
  let found: Record<string, unknown> | undefined;
  try {
    const res = await deps.db.send(
      new DeleteCommand({
        TableName: deps.connectionsTable,
        Key: connectionKeys.ticket(ticket),
        // 条件が無いと、同時に使われたとき両方に削除前の内容が返ることがある
        ConditionExpression: "attribute_exists(PK)",
        ReturnValues: "ALL_OLD",
      }),
    );
    found = res.Attributes;
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) return undefined;
    throw error;
  }
  if (!found || (found.expiresAt as number) < deps.now().getTime()) return undefined;
  return { tripId: found.tripId as string, userId: found.userId as string };
}
