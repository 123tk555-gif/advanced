import {
  type ClientMessage,
  PING_INTERVAL_MS,
  parseServerMessage,
  type ServerMessage,
} from "@tritri/shared";

/** 返事がこれだけ無ければ、切れたとみなす */
const REPLY_TIMEOUT_MS = 10_000;

export type SocketState = "connecting" | "online" | "offline" | "paused" | "revoked";
export type Presence = Extract<ServerMessage, { type: "presence" }>;

/** ブラウザの WebSocket のうち、ここで使う分 */
export interface SocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

/** つなぎ直すまでの待ち時間(1 秒から倍々、30 秒まで) */
export function retryDelay(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** attempt);
}

interface Options {
  /** 1 回限りのチケット。つなぐたびに取り直す */
  getTicket(): Promise<string>;
  open(ticket: string): SocketLike;
  /** チケットの失敗が「旅を見られなくなった」か */
  isGone(error: unknown): boolean;
  onState(state: SocketState): void;
  onPresence(presence: Presence): void;
  /** 読み直してほしい(変更の合図・つながった直後) */
  onRefresh(): void;
}

/** 旅 1 つ分の WebSocket。切れたら自動でつなぎ直す */
export function createTripSocket(options: Options) {
  let socket: SocketLike | null = null;
  let opened = false;
  let state: SocketState | "idle" | "stopped" = "idle";
  /** つなぐ試みの番号。待っている間に止めた・やり直した試みの答えは捨てる */
  let generation = 0;
  let attempt = 0;
  let lastSeq = 0;
  let editing: string | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let replyTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;

  function setState(next: SocketState) {
    if (state === next) return;
    state = next;
    options.onState(next);
  }

  function send(message: ClientMessage) {
    if (opened) socket?.send(JSON.stringify(message));
  }

  function teardown() {
    generation += 1;
    clearTimeout(retryTimer);
    clearTimeout(replyTimer);
    clearInterval(pingTimer);
    opened = false;
    if (!socket) return;
    socket.onopen = null;
    socket.onclose = null;
    socket.onmessage = null;
    socket.close();
    socket = null;
  }

  function lost() {
    teardown();
    setState("offline");
    retryTimer = setTimeout(connect, retryDelay(attempt));
    attempt += 1;
  }

  function revoked() {
    teardown();
    setState("revoked");
  }

  function waitForReply() {
    clearTimeout(replyTimer);
    replyTimer = setTimeout(lost, REPLY_TIMEOUT_MS);
  }

  function receive(data: unknown) {
    const message = typeof data === "string" ? parseServerMessage(data) : null;
    if (!message) return;
    clearTimeout(replyTimer);
    if (message.type === "revoked") return revoked();
    if (message.type === "changed") options.onRefresh();
    if (message.type !== "presence") return;

    attempt = 0;
    if (state !== "online") {
      setState("online");
      // つながっていなかった間の変更を取り込む
      options.onRefresh();
    }
    if (message.seq > lastSeq) {
      lastSeq = message.seq;
      options.onPresence(message);
    }
  }

  async function connect() {
    teardown();
    const mine = generation;
    lastSeq = 0;
    try {
      const ticket = await options.getTicket();
      if (mine !== generation) return;
      socket = options.open(ticket);
    } catch (error) {
      if (mine !== generation) return;
      if (options.isGone(error)) revoked();
      else lost();
      return;
    }
    waitForReply();
    socket.onclose = lost;
    socket.onmessage = (event) => receive(event.data);
    socket.onopen = () => {
      opened = true;
      send({ type: "hello" });
      if (editing) send({ type: "editing", itemId: editing });
      pingTimer = setInterval(() => {
        send({ type: "ping" });
        waitForReply();
      }, PING_INTERVAL_MS);
    };
  }

  return {
    start() {
      setState("connecting");
      void connect();
    },
    setEditing(itemId: string | null) {
      if (editing === itemId) return;
      editing = itemId;
      send({ type: "editing", itemId });
    },
    /** タブが長く隠れた */
    pause() {
      if (state === "revoked" || state === "stopped") return;
      teardown();
      setState("paused");
    },
    /** タブに戻った・通信が戻った。待たずにつなぐ */
    resume() {
      if (state !== "paused" && state !== "offline") return;
      attempt = 0;
      if (state === "paused") setState("connecting");
      void connect();
    },
    stop() {
      teardown();
      state = "stopped";
    },
  };
}
