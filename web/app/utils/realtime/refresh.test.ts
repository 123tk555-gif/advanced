import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRefresher, MIN_INTERVAL_MS, REFRESH_DELAY_MS, SPREAD_MS } from "./refresh";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  const finish: (() => void)[] = [];
  const load = vi.fn(() => new Promise<void>((resolve) => finish.push(resolve)));
  let blocked = false;
  let spread = 0;
  const refresher = createRefresher(load, () => blocked, { random: () => spread });
  const tick = (ms = REFRESH_DELAY_MS) => vi.advanceTimersByTimeAsync(ms);
  return {
    finish,
    load,
    refresher,
    tick,
    block: (value: boolean) => (blocked = value),
    spreadBy: (value: number) => (spread = value),
  };
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
    await tick(MIN_INTERVAL_MS);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("ほかの人の変更による読み直しは、前の読み直しから 2 秒あける(大勢の旅で DB の読み取りを抑える)", async () => {
    const { finish, load, refresher, tick } = setup();
    refresher.request();
    await tick();
    finish[0]?.();
    await tick(0);
    // 前の読み直しは、合図と同じ時刻に始まっている
    refresher.request();
    await tick(MIN_INTERVAL_MS - 1);
    expect(load).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("しばらく何も無かった後の変更は、すぐ読む", async () => {
    const { finish, load, refresher, tick } = setup();
    refresher.request();
    await tick();
    finish[0]?.();
    await tick(MIN_INTERVAL_MS * 3);
    refresher.request();
    await tick();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("全員が同じ瞬間に読まないよう、少しずらす", async () => {
    const { load, refresher, tick, spreadBy } = setup();
    spreadBy(1);
    refresher.request();
    await tick(REFRESH_DELAY_MS + SPREAD_MS - 1);
    expect(load).not.toHaveBeenCalled();
    await tick(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("自分の変更は、間隔に関係なくすぐ読む", async () => {
    const { finish, load, refresher, tick } = setup();
    refresher.request();
    await tick();
    finish[0]?.();
    await tick(0);
    refresher.now();
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
