import { describe, expect, it, vi } from "vitest";
import { sendWithToken } from "./retry";

const res = (status: number) => new Response(null, { status });

describe("トークンを付けて送る", () => {
  it("トークンを付けて 1 回送る", async () => {
    const send = vi.fn(async () => res(200));
    const token = vi.fn(async () => "t1");
    const out = await sendWithToken(send, token);
    expect(out.status).toBe(200);
    expect(send).toHaveBeenCalledWith("t1");
    expect(token).toHaveBeenCalledWith(false);
  });

  it("401 なら、トークンを取り直して 1 回だけ送り直す", async () => {
    const send = vi.fn(async (t: string | null) => res(t === "fresh" ? 200 : 401));
    const token = vi.fn(async (force: boolean) => (force ? "fresh" : "old"));
    const out = await sendWithToken(send, token);
    expect(out.status).toBe(200);
    expect(send.mock.calls.map((c) => c[0])).toEqual(["old", "fresh"]);
  });

  it("取り直しても 401 なら、それを返す(何度も繰り返さない)", async () => {
    const send = vi.fn(async () => res(401));
    const out = await sendWithToken(send, async () => "t");
    expect(out.status).toBe(401);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("ログインしていない(トークンが無い)なら、送り直さない", async () => {
    const send = vi.fn(async () => res(401));
    const out = await sendWithToken(send, async () => null);
    expect(out.status).toBe(401);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(null);
  });

  it("取り直しに失敗したら、最初の 401 を返す", async () => {
    const send = vi.fn(async () => res(401));
    const token = vi.fn(async (force: boolean) => {
      if (force) throw new Error("refresh failed");
      return "old";
    });
    const out = await sendWithToken(send, token);
    expect(out.status).toBe(401);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
