import { randomUUID } from "node:crypto";
import { type serve, upgradeWebSocket } from "@hono/node-server";
import type { Hono } from "hono";
import type { WSContext } from "hono/ws";
import { WebSocketServer } from "ws";
import type { Realtime } from "./service.js";
import type { Sender } from "./types.js";

/**
 * 手元の開発用サーバーの WebSocket(本番には含めない)。
 * 本番は API Gateway WebSocket が同じ役目をする。
 */
export function createLocalSockets() {
  const sockets = new Map<string, WSContext>();
  /** 登録は済んだが、まだ開いていない接続(開くと画面が読み直すので、送らなくてよい) */
  const opening = new Set<string>();

  const sender: Sender = {
    async send(id, message) {
      const ws = sockets.get(id);
      if (!ws) return opening.has(id) ? "sent" : "gone";
      if (ws.readyState !== 1) return "gone";
      ws.send(JSON.stringify(message));
      return "sent";
    },
    async close(id) {
      sockets.get(id)?.close(1000);
    },
  };

  function mount(server: Hono, options: { realtime: Realtime; origin: string }) {
    const { realtime, origin } = options;
    const accepted = new WeakMap<Request, string>();

    server.get(
      "/ws",
      async (c, next) => {
        // WebSocket には CORS が効かないので、Origin を自分で確かめる(チケットを使う前に)
        if (c.req.header("origin") !== origin) return c.body(null, 403);
        if (c.req.header("upgrade")?.toLowerCase() !== "websocket") return c.body(null, 426);
        const id = randomUUID();
        if (!(await realtime.connect(id, c.req.query("ticket") ?? ""))) return c.body(null, 403);
        opening.add(id);
        setTimeout(() => opening.delete(id), 10_000).unref();
        accepted.set(c.req.raw, id);
        return next();
      },
      upgradeWebSocket((c) => {
        const id = accepted.get(c.req.raw) as string;
        // 1 つの接続の受信と切断は、届いた順に処理する
        let queue = Promise.resolve();
        const inOrder = (run: () => Promise<void>) => {
          queue = queue.then(run).catch((error) => {
            console.error("WebSocket の処理に失敗しました", error);
          });
        };
        return {
          onOpen(_event, ws) {
            opening.delete(id);
            sockets.set(id, ws);
          },
          onMessage(event) {
            const { data } = event;
            if (typeof data === "string") inOrder(() => realtime.message(id, data));
          },
          onClose() {
            sockets.delete(id);
            inOrder(() => realtime.disconnect(id));
          },
          // 受け口が無いと、大きすぎる受信などでプロセスごと落ちる
          onError() {},
        };
      }),
    );
  }

  return { sender, mount };
}

/** HTTP のサーバーに相乗りする WebSocket サーバー */
export function createSocketServer() {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  // ws と node-server は実行時には合うが、型の宣言(send の引数など)が食い違うため読み替える
  const websocket = { server: wss } as unknown as NonNullable<
    Parameters<typeof serve>[0]["websocket"]
  >;
  return { wss, websocket };
}
