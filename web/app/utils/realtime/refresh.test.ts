import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRefresher, REFRESH_DELAY_MS } from "./refresh";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  const finish: (() => void)[] = [];
  const load = vi.fn(() => new Promise<void>((resolve) => finish.push(resolve)));
  let blocked = false;
  const refresher = createRefresher(load, () => blocked);
  const tick = (ms = REFRESH_DELAY_MS) => vi.advanceTimersByTimeAsync(ms);
  return { finish, load, refresher, tick, block: (value: boolean) => (blocked = value) };
}

describe("createRefresher", () => {
  it("続けて届いた合図は 1 回の読み直しにまとめる", async () => {
    const { load, refresher, tick } = setup();
    refresher.request();
    refresher.request();
    refresher.request();
    await tick();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("合図が途切れなくても、待たせ続けない", async () => {
    const { load, refresher, tick } = setup();
    for (let ms = 0; ms < REFRESH_DELAY_MS; ms += 50) {
      refresher.request();
      await tick(50);
    }
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("読み直し中に届いたら、重ねずに終わってからもう 1 回(古い答えに追い越されない)", async () => {
    const { finish, load, refresher, tick } = setup();
    refresher.request();
    await tick();
    refresher.request();
    refresher.request();
    await tick();
    expect(load).toHaveBeenCalledTimes(1);
    finish[0]?.();
    await tick(0);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("ダイアログ中・変換中は待ち、終わったら読み直す", async () => {
    const { load, refresher, tick, block } = setup();
    block(true);
    refresher.request();
    await tick(5000);
    expect(load).not.toHaveBeenCalled();
    block(false);
    refresher.resume();
    await tick();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("待っている合図が無ければ、resume では読み直さない", async () => {
    const { load, refresher, tick } = setup();
    refresher.resume();
    await tick();
    expect(load).not.toHaveBeenCalled();
  });

  it("自分の変更(now)は待たずに読む", async () => {
    const { load, refresher, block } = setup();
    block(true);
    refresher.now();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("止めたら読まない", async () => {
    const { load, refresher, tick } = setup();
    refresher.request();
    refresher.stop();
    await tick();
    refresher.now();
    expect(load).not.toHaveBeenCalled();
  });
});
