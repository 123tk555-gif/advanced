import type { ServerMessage } from "@tritri/shared";
import type { Sender } from "../src/realtime/types.js";

/** 送ったものを覚えておくだけの送信部品(テスト用) */
export function recordingSender() {
  const inbox = new Map<string, ServerMessage[]>();
  const closed = new Set<string>();
  const gone = new Set<string>();
  const broken = new Set<string>();

  const sender: Sender = {
    async send(id, message) {
      if (broken.has(id)) throw new Error("send failed");
      if (gone.has(id)) return "gone";
      inbox.set(id, [...(inbox.get(id) ?? []), message]);
      return "sent";
    },
    async close(id) {
      closed.add(id);
    },
  };

  return {
    sender,
    closed,
    /** もう無い接続にする(送ると 410 に当たる) */
    gone,
    /** 送ると例外になる接続にする */
    broken,
    of: (id: string) => inbox.get(id) ?? [],
    types: (id: string) => (inbox.get(id) ?? []).map((m) => m.type),
    lastPresence: (id: string) => (inbox.get(id) ?? []).findLast((m) => m.type === "presence"),
    clear: () => inbox.clear(),
  };
}
