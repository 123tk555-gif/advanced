import { describe, expect, it, vi } from "vitest";
import { createLookupStore, RETRY_AFTER_MS } from "./store";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createLookupStore", () => {
  it("初めては「計算中」。重なっても問い合わせは 1 回で、答えが来たら知らせて覚える", async () => {
    const load = vi.fn(async () => ({ minutes: 12 }));
    const notify = vi.fn();
    const store = createLookupStore(load, notify);
    expect(store.get("a")).toEqual({ status: "loading" });
    expect(store.get("a")).toEqual({ status: "loading" });
    await flush();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(store.get("a")).toEqual({ status: "ok", value: { minutes: 12 } });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("キーが違えば、別に問い合わせる", () => {
    const load = vi.fn(async () => 1);
    const store = createLookupStore(load, () => {});
    store.get("a");
    store.get("b");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("「無い」という答えは覚え、時間がたっても問い合わせ直さない", async () => {
    let now = 0;
    const load = vi.fn(async () => null);
    const store = createLookupStore(
      load,
      () => {},
      () => now,
    );
    store.get("a");
    await flush();
    now += RETRY_AFTER_MS * 10;
    expect(store.get("a")).toEqual({ status: "none" });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("失敗の知らせで 2 か所が読み直しても、問い合わせは繰り返さない(料金の枠を使い切らない)", async () => {
    let calls = 0;
    const load = async () => {
      calls += 1;
      if (calls > 500) return null; // テストを終わらせるための歯止め
      throw new Error("quota");
    };
    const render = () => {
      store.get("a"); // 一覧
      store.get("a"); // 地図
    };
    const store = createLookupStore(load, render);
    render();
    await flush();
    await flush();
    expect(calls).toBe(1);
    expect(store.get("a")).toEqual({ status: "failed" });
  });

  it("失敗は、しばらくたってから聞かれたら問い合わせ直す", async () => {
    let now = 0;
    const load = vi.fn(async () => {
      throw new Error("network");
    });
    const store = createLookupStore(
      load,
      () => {},
      () => now,
    );
    store.get("a");
    await flush();
    now += RETRY_AFTER_MS - 1;
    expect(store.get("a")).toEqual({ status: "failed" });
    now += 1;
    expect(store.get("a")).toEqual({ status: "loading" });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("先にわかった答えを入れておくと、問い合わせない(場所を選んだときの座標)", () => {
    const load = vi.fn(async () => 1);
    const store = createLookupStore(load, () => {});
    store.put("a", 7);
    expect(store.get("a")).toEqual({ status: "ok", value: 7 });
    expect(load).not.toHaveBeenCalled();
  });
});
