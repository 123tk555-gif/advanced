import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSuggester } from "./suggest";
import type { PlaceSearch, Suggestion } from "./types";

const s = (id: string): Suggestion => ({ id, main: id });

describe("createSuggester", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(answer: (text: string) => Promise<Suggestion[]>) {
    const search: PlaceSearch = { suggest: vi.fn(answer), resolve: vi.fn(), locate: vi.fn() };
    const onResult = vi.fn();
    const suggester = createSuggester(search, onResult, { delayMs: 300, minLength: 2 });
    return { search, onResult, suggester };
  }

  it("入力が止まってから 300ms 待って、最後の入力だけを問い合わせる", async () => {
    const { search, onResult, suggester } = setup(async (t) => [s(t)]);
    suggester.input("京");
    suggester.input("京都");
    suggester.input("京都駅");
    await vi.advanceTimersByTimeAsync(299);
    expect(search.suggest).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(search.suggest).toHaveBeenCalledTimes(1);
    expect(search.suggest).toHaveBeenCalledWith("京都駅", undefined);
    expect(onResult).toHaveBeenLastCalledWith([s("京都駅")]);
  });

  it("2 文字より短いときは問い合わせず、候補を空にする", async () => {
    const { search, onResult, suggester } = setup(async (t) => [s(t)]);
    suggester.input(" 京 ");
    await vi.advanceTimersByTimeAsync(300);
    expect(search.suggest).not.toHaveBeenCalled();
    expect(onResult).toHaveBeenLastCalledWith([]);
  });

  it("古い問い合わせの答えが後から届いても、新しい入力の候補を上書きしない", async () => {
    const answers: Record<string, (v: Suggestion[]) => void> = {};
    const { onResult, suggester } = setup(
      (t) => new Promise<Suggestion[]>((resolve) => (answers[t] = resolve)),
    );
    suggester.input("京都");
    await vi.advanceTimersByTimeAsync(300);
    suggester.input("清水寺");
    await vi.advanceTimersByTimeAsync(300);
    answers.清水寺?.([s("清水寺")]);
    await vi.advanceTimersByTimeAsync(0);
    answers.京都?.([s("京都駅")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(onResult).toHaveBeenLastCalledWith([s("清水寺")]);
    expect(onResult).not.toHaveBeenCalledWith([s("京都駅")]);
  });

  it("問い合わせが失敗したら候補を空にする", async () => {
    const { onResult, suggester } = setup(async () => {
      throw new Error("network");
    });
    suggester.input("京都");
    await vi.advanceTimersByTimeAsync(300);
    expect(onResult).toHaveBeenLastCalledWith([]);
  });

  it("問い合わせる時点の、近くを優先する位置を渡す", async () => {
    const search: PlaceSearch = {
      suggest: vi.fn(async () => []),
      resolve: vi.fn(),
      locate: vi.fn(),
    };
    let near: { lat: number; lng: number } | undefined;
    const suggester = createSuggester(search, () => {}, { near: () => near });
    suggester.input("四条");
    // 入力の時点では未取得でも、待っている間に届けば使う
    near = { lat: 34.98, lng: 135.75 };
    await vi.advanceTimersByTimeAsync(300);
    expect(search.suggest).toHaveBeenCalledWith("四条", near);
  });

  it("cancel したら、待っている問い合わせも届く答えも捨てる", async () => {
    const { search, onResult, suggester } = setup(async (t) => [s(t)]);
    suggester.input("京都");
    suggester.cancel();
    await vi.advanceTimersByTimeAsync(300);
    expect(search.suggest).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });
});
