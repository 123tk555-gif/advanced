import type { Realtime } from "./service.js";

/** 受け取る 1 回分の上限(手元の ws の maxPayload と同じ) */
export const MAX_MESSAGE_BYTES = 4096;

/** API Gateway WebSocket から Lambda に届くもののうち、使う分 */
export interface WsEvent {
  requestContext: { routeKey?: string; connectionId?: string };
  headers?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
}

type Entry = Pick<Realtime, "connect" | "message" | "disconnect">;

function header(event: WsEvent, name: string): string | undefined {
  const found = Object.entries(event.headers ?? {}).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  return found?.[1];
}

/**
 * API Gateway WebSocket の入口。$connect・$disconnect・$default を、リアルタイム更新の仕組みにつなぐ。
 * $connect で 200 以外を返すと、API Gateway が接続を断る。
 */
export async function handleWebSocketEvent(
  realtime: Entry,
  webOrigin: string,
  event: WsEvent,
): Promise<{ statusCode: number }> {
  const { routeKey, connectionId } = event.requestContext;
  if (!connectionId) return { statusCode: 400 };

  if (routeKey === "$connect") {
    // WebSocket には CORS が効かないので、Origin を自分で確かめる(チケットを使う前に)
    if (header(event, "origin") !== webOrigin) return { statusCode: 403 };
    const ticket = event.queryStringParameters?.ticket;
    if (!ticket) return { statusCode: 403 };
    return { statusCode: (await realtime.connect(connectionId, ticket)) ? 200 : 403 };
  }
  if (routeKey === "$disconnect") {
    await realtime.disconnect(connectionId);
    return { statusCode: 200 };
  }
  if (routeKey === "$default") {
    const body = event.body;
    // 画面は文字(JSON)だけを送る。バイナリや大きすぎるものは捨てる
    if (
      typeof body === "string" &&
      !event.isBase64Encoded &&
      Buffer.byteLength(body) <= MAX_MESSAGE_BYTES
    ) {
      await realtime.message(connectionId, body);
    }
    return { statusCode: 200 };
  }
  return { statusCode: 200 };
}
