import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createLocalSockets, createSocketServer } from "../src/realtime/local.js";
import { useTestApi } from "./helpers.js";

/** 手元の開発用サーバーの WebSocket を、本物の接続で確かめる */
const ORIGIN = "http://localhost:3000";
const sockets = createLocalSockets();
const api = useTestApi({ sender: sockets.sender });

const server = new Hono();
sockets.mount(server, { realtime: api.realtime, origin: ORIGIN });
const { wss, websocket } = createSocketServer();
let http: ReturnType<typeof serve>;
let port = 0;
let base = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    http = serve(
      { fetch: server.fetch, hostname: "127.0.0.1", port: 0, websocket },
      (info: AddressInfo) => {
        port = info.port;
        resolve();
      },
    );
  });
  await api.signUp("owner");
  base = `/trips/${(await api.createTrip("owner")).tripId}`;
});
afterAll(async () => {
  for (const client of wss.clients) client.terminate();
  await new Promise((resolve) => http.close(resolve));
});

async function ticket() {
  return (await api.call("owner", "POST", `${base}/ws-ticket`)).body.ticket as string;
}

/** つなぐ。断られたら HTTP の状態コードを返す */
function connect(token: string, origin?: string): Promise<WebSocket | number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${token}`, origin ? { origin } : {});
    ws.on("open", () => resolve(ws));
    ws.on("unexpected-response", (req, res) => {
      resolve(res.statusCode ?? 0);
      req.destroy();
    });
    ws.on("error", reject);
  });
}

describe("手元の WebSocket", () => {
  it("よそのサイト・Origin の無い接続は 403。チケットも使われない", async () => {
    const token = await ticket();
    expect(await connect(token, "https://evil.example")).toBe(403);
    expect(await connect(token)).toBe(403);
    const ws = await connect(token, ORIGIN);
    expect(ws).toBeInstanceOf(WebSocket);
    (ws as WebSocket).close();
  });

  it("チケットが無ければ 403", async () => {
    expect(await connect("", ORIGIN)).toBe(403);
    expect(await connect("A".repeat(43), ORIGIN)).toBe(403);
  });

  it("つないで、変更の合図を受け取れる", async () => {
    const ws = (await connect(await ticket(), ORIGIN)) as WebSocket;
    const got: string[] = [];
    ws.on("message", (data) => got.push(JSON.parse(String(data)).type));
    ws.send('{"type":"hello"}');
    await expect.poll(() => got, { timeout: 5000 }).toContain("presence");
    await api.call("owner", "POST", `${base}/items`, { day: 1, order: "a0", title: "集合" });
    await expect.poll(() => got, { timeout: 5000 }).toContain("changed");
    ws.close();
  });
});
