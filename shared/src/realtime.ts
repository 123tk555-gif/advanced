import { z } from "zod";

/**
 * リアルタイム更新(WebSocket)でやり取りするメッセージ。
 * 旅の中身は載せない。「変わった」という合図を受けた画面が GET /trips/:tripId で読み直す。
 */

/** 受け取るメッセージの大きさの上限(文字数) */
export const MAX_CLIENT_MESSAGE = 1024;
/** 画面が ping を送る間隔 */
export const PING_INTERVAL_MS = 60_000;
/** これだけ音沙汰のない接続は、いないものとみなす */
export const STALE_CONNECTION_MS = 150_000;

const clientMessage = z.discriminatedUnion("type", [
  /** つながった直後に送る。受けたサーバーが「今見ている人」を全員に配る */
  z.strictObject({ type: z.literal("hello") }),
  z.strictObject({ type: z.literal("ping") }),
  /** 編集中の予定。編集していなければ null */
  z.strictObject({
    type: z.literal("editing"),
    itemId: z
      .string()
      .regex(/^[A-Za-z0-9]{1,64}$/)
      .nullable(),
  }),
]);
export type ClientMessage = z.infer<typeof clientMessage>;

const viewer = z.object({ userId: z.string(), displayName: z.string() });
export type Viewer = z.infer<typeof viewer>;

const editor = viewer.extend({ itemId: z.string() });
export type Editor = z.infer<typeof editor>;

const serverMessage = z.discriminatedUnion("type", [
  /** 旅が変わった */
  z.object({ type: z.literal("changed") }),
  /** 今見ている人と、編集中の予定。seq が小さいものは追い越された古い知らせ */
  z.object({
    type: z.literal("presence"),
    seq: z.number().int(),
    people: z.array(viewer),
    editing: z.array(editor),
  }),
  /** この旅を見られなくなった */
  z.object({ type: z.literal("revoked") }),
  z.object({ type: z.literal("pong") }),
]);
export type ServerMessage = z.infer<typeof serverMessage>;

function read<T>(schema: z.ZodType<T>, raw: string): T | null {
  try {
    const result = schema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null; // JSON でない
  }
}

/** 画面から届いたメッセージ。読めなければ null */
export function parseClientMessage(raw: string): ClientMessage | null {
  return raw.length > MAX_CLIENT_MESSAGE ? null : read(clientMessage, raw);
}

/** サーバーから届いたメッセージ。読めなければ null */
export function parseServerMessage(raw: string): ServerMessage | null {
  return read(serverMessage, raw);
}
