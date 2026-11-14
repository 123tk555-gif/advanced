import { describe, expect, it } from "vitest";
import { useTestApi } from "./helpers.js";

const api = useTestApi();

describe("プロフィール(/me)", () => {
  it("ログインしていないと 401", async () => {
    expect((await api.call(null, "GET", "/me")).status).toBe(401);
    expect((await api.call(null, "PUT", "/me", { displayName: "たろう" })).status).toBe(401);
  });

  it("表示名を登録する前は 404", async () => {
    expect((await api.call("u-new", "GET", "/me")).status).toBe(404);
  });

  it("表示名を登録・変更でき、前後の空白は取り除く", async () => {
    const put = await api.call("u-taro", "PUT", "/me", { displayName: "  たろう  " });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ userId: "u-taro", displayName: "たろう" });

    await api.call("u-taro", "PUT", "/me", { displayName: "タロウ" });
    const get = await api.call("u-taro", "GET", "/me");
    expect(get.status).toBe(200);
    expect(get.body).toEqual({ userId: "u-taro", displayName: "タロウ" });
  });

  it.each([
    ["空", ""],
    ["空白だけ", "   "],
    ["21 文字", "あ".repeat(21)],
  ])("表示名が正しくない(%s)と 400", async (_label, displayName) => {
    expect((await api.call("u-bad", "PUT", "/me", { displayName })).status).toBe(400);
  });

  it("20 文字までは登録できる", async () => {
    expect((await api.call("u-20", "PUT", "/me", { displayName: "あ".repeat(20) })).status).toBe(
      200,
    );
  });
});
