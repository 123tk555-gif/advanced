import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTripSocket, retryDelay, type SocketLike } from "./socket";

class FakeSocket implements SocketLike {
  sent: { type: string }[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

const presence = (seq: number, name = "たろう") => ({
  type: "presence",
  seq,
  people: [{ userId: "u", displayName: name }],
  editing: [],
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function setup(getTicket = vi.fn(async () => "ticket")) {
  const sockets: FakeSocket[] = [];
  const options = {
    getTicket,
    open: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    isGone: (error: unknown) => error === "gone",
    onState: vi.fn(),
    onPresence: vi.fn(),
    onRefresh: vi.fn(),
  };
  const client = createTripSocket(options);
  client.start();
  await vi.advanceTimersByTimeAsync(0);
  async function online() {
    const socket = sockets.at(-1) as FakeSocket;
    socket.onopen?.();
    socket.receive(presence(1));
    await vi.advanceTimersByTimeAsync(0);
    return socket;
  }
  return { client, sockets, options, online };
}

describe("retryDelay", () => {
  it("1 秒から倍々に延び、30 秒で頭打ち", () => {
    expect([0, 1, 2, 3, 4, 5, 20].map(retryDelay)).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
  });
});

describe("createTripSocket", () => {
  it("つながったら名乗り、知らせが来た時点で online。取りこぼしに備えて読み直す", async () => {
    const { options, online } = await setup();
    expect(options.onState).toHaveBeenLastCalledWith("connecting");
    const socket = await online();
    expect(socket.sent).toContainEqual({ type: "hello" });
    expect(options.onState).toHaveBeenLastCalledWith("online");
    expect(options.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("変更の合図で読み直す。読めない知らせは捨てる", async () => {
    const { options, online } = await setup();
    const socket = await online();
    options.onRefresh.mockClear();
    socket.receive({ type: "changed" });
    socket.receive({ type: "something" });
    expect(options.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("追い越された古い「今見ている人」は捨てる", async () => {
    const { options, online } = await setup();
    const socket = await online();
    socket.receive(presence(5, "新"));
    socket.receive(presence(4, "旧"));
    expect(options.onPresence.mock.lastCall?.[0].people[0].displayName).toBe("新");
  });

  it("切れたら offline にし、新しいチケットで 1 秒 → 2 秒 → 4 秒とつなぎ直す", async () => {
    const { sockets, options, online } = await setup();
    (await online()).onclose?.();
    expect(options.onState).toHaveBeenLastCalledWith("offline");
    for (const [i, wait] of [1000, 2000, 4000].entries()) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(sockets).toHaveLength(i + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(sockets).toHaveLength(i + 2);
      sockets.at(-1)?.onclose?.();
    }
    expect(options.getTicket).toHaveBeenCalledTimes(4);
  });

  it("つながったら、待ち時間は 1 秒に戻る", async () => {
    const { sockets, online } = await setup();
    sockets[0]?.onclose?.();
    await vi.advanceTimersByTimeAsync(1000);
    (await online()).onclose?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(sockets).toHaveLength(3);
  });

  it("チケットが取れなくても、つなぎ直す", async () => {
    const { options } = await setup(vi.fn().mockRejectedValue(new Error("network")));
    expect(options.onState).toHaveBeenLastCalledWith("offline");
    await vi.advanceTimersByTimeAsync(1000);
    expect(options.getTicket).toHaveBeenCalledTimes(2);
  });

  it("旅が見られなくなっていたら、つなぎ直さない", async () => {
    const { options } = await setup(vi.fn().mockRejectedValue("gone"));
    expect(options.onState).toHaveBeenLastCalledWith("revoked");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(options.getTicket).toHaveBeenCalledTimes(1);
  });

  it("revoked を受けたら切って、つなぎ直さない", async () => {
    const { sockets, options, online } = await setup();
    const socket = await online();
    socket.receive({ type: "revoked" });
    expect(socket.closed).toBe(true);
    expect(options.onState).toHaveBeenLastCalledWith("revoked");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sockets).toHaveLength(1);
  });

  it("60 秒ごとに ping。10 秒返事が無ければ、切れたとみなす", async () => {
    const { options, online } = await setup();
    const socket = await online();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(socket.sent).toContainEqual({ type: "ping" });
    socket.receive({ type: "pong" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(options.onState).toHaveBeenLastCalledWith("online");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(socket.closed).toBe(true);
    expect(options.onState).toHaveBeenLastCalledWith("offline");
  });

  it("開いても知らせが来なければ、つなぎ直す", async () => {
    const { sockets, options } = await setup();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets[0]?.closed).toBe(true);
    expect(options.onState).toHaveBeenLastCalledWith("offline");
  });

  it("編集中の予定は、つなぎ直した後も送る", async () => {
    const { client, sockets, online } = await setup();
    const first = await online();
    client.setEditing("item1");
    expect(first.sent).toContainEqual({ type: "editing", itemId: "item1" });
    first.onclose?.();
    await vi.advanceTimersByTimeAsync(1000);
    sockets[1]?.onopen?.();
    expect(sockets[1]?.sent).toContainEqual({ type: "editing", itemId: "item1" });
  });

  it("休止すると切ってつなぎ直さず、再開するとすぐつなぐ", async () => {
    const { client, sockets, options, online } = await setup();
    const socket = await online();
    client.pause();
    expect(socket.closed).toBe(true);
    expect(options.onState).toHaveBeenLastCalledWith("paused");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sockets).toHaveLength(1);
    client.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(2);
  });

  it("待っている間に resume すると、すぐつなぐ", async () => {
    const { client, sockets, online } = await setup();
    (await online()).onclose?.();
    client.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(sockets).toHaveLength(2);
  });

  it("チケットを待つ間に止めたら、つながない", async () => {
    let give: (ticket: string) => void = () => {};
    const waiting = vi.fn(() => new Promise<string>((resolve) => (give = resolve)));
    const { client, sockets } = await setup(waiting);
    client.stop();
    give("ticket");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sockets).toHaveLength(0);
  });
});
