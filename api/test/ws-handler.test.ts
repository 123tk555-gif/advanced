import { describe, expect, it, vi } from "vitest";
import {
  handleWebSocketEvent,
  MAX_MESSAGE_BYTES,
  type WsEvent,
} from "../src/realtime/ws-handler.js";

const ORIGIN = "https://tritri.example";

function realtime(connectOk = true) {
  return {
    connect: vi.fn(async () => connectOk),
    message: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
  };
}

function event(routeKey: string, extra: Partial<WsEvent> = {}): WsEvent {
  return { requestContext: { routeKey, connectionId: "conn-1" }, ...extra };
}

const connectEvent = (headers: Record<string, string>, ticket?: string) =>
  event("$connect", {
    headers,
    ...(ticket === undefined ? {} : { queryStringParameters: { ticket } }),
  });

describe("API Gateway WebSocket の入口", () => {
  it("$connect: 画面の Origin とチケットが正しければ、つなぐ", async () => {
    const r = realtime(true);
    const res = await handleWebSocketEvent(r, ORIGIN, connectEvent({ Origin: ORIGIN }, "t1"));
    expect(res.statusCode).toBe(200);
    expect(r.connect).toHaveBeenCalledWith("conn-1", "t1");
  });

  it("$connect: ヘッダー名の大文字・小文字は問わない", async () => {
    const r = realtime(true);
    const res = await handleWebSocketEvent(r, ORIGIN, connectEvent({ origin: ORIGIN }, "t1"));
    expect(res.statusCode).toBe(200);
  });

  it("$connect: よそのサイトからは、チケットを使う前に断る", async () => {
    const r = realtime(true);
    const res = await handleWebSocketEvent(
      r,
      ORIGIN,
      connectEvent({ Origin: "https://evil.example" }, "t1"),
    );
    expect(res.statusCode).toBe(403);
    expect(r.connect).not.toHaveBeenCalled();
    const none = await handleWebSocketEvent(r, ORIGIN, connectEvent({}, "t1"));
    expect(none.statusCode).toBe(403);
  });

  it("$connect: チケットが無い・使えないなら断る", async () => {
    const r = realtime(false);
    expect(
      (await handleWebSocketEvent(r, ORIGIN, connectEvent({ Origin: ORIGIN }))).statusCode,
    ).toBe(403);
    expect(r.connect).not.toHaveBeenCalled();
    expect(
      (await handleWebSocketEvent(r, ORIGIN, connectEvent({ Origin: ORIGIN }, "used"))).statusCode,
    ).toBe(403);
  });

  it("$disconnect: 接続を片付ける", async () => {
    const r = realtime();
    const res = await handleWebSocketEvent(r, ORIGIN, event("$disconnect"));
    expect(res.statusCode).toBe(200);
    expect(r.disconnect).toHaveBeenCalledWith("conn-1");
  });

  it("$default: 受け取った文字を渡す。大きすぎる・文字でないものは捨てる", async () => {
    const r = realtime();
    await handleWebSocketEvent(r, ORIGIN, event("$default", { body: '{"type":"ping"}' }));
    expect(r.message).toHaveBeenCalledWith("conn-1", '{"type":"ping"}');

    r.message.mockClear();
    await handleWebSocketEvent(
      r,
      ORIGIN,
      event("$default", { body: "x".repeat(MAX_MESSAGE_BYTES + 1) }),
    );
    await handleWebSocketEvent(
      r,
      ORIGIN,
      event("$default", { body: "eyJ0eXBlIjoicGluZyJ9", isBase64Encoded: true }),
    );
    await handleWebSocketEvent(r, ORIGIN, event("$default"));
    expect(r.message).not.toHaveBeenCalled();
  });

  it("知らない経路は何もしない", async () => {
    const r = realtime();
    const res = await handleWebSocketEvent(r, ORIGIN, event("other"));
    expect(res.statusCode).toBe(200);
    expect(r.connect).not.toHaveBeenCalled();
    expect(r.message).not.toHaveBeenCalled();
    expect(r.disconnect).not.toHaveBeenCalled();
  });
});
