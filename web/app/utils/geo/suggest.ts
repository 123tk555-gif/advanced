import type { PlaceSearch, Suggestion } from "./types";

/**
 * 場所の入力欄の候補を問い合わせる仕組み。
 * - 入力が止まってから delayMs 待ち、最後の入力だけを問い合わせる(料金の枠を無駄に使わないため)
 * - minLength 文字より短いときは問い合わせない
 * - 古い問い合わせの答えが後から届いても捨てる
 */
export function createSuggester(
  search: PlaceSearch,
  onResult: (suggestions: Suggestion[]) => void,
  { delayMs = 300, minLength = 2 } = {},
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest = 0;

  function cancel() {
    clearTimeout(timer);
    latest += 1;
  }

  function input(raw: string) {
    cancel();
    const text = raw.trim();
    if (text.length < minLength) {
      onResult([]);
      return;
    }
    const ticket = latest;
    timer = setTimeout(async () => {
      let found: Suggestion[];
      try {
        found = await search.suggest(text);
      } catch {
        found = [];
      }
      if (ticket === latest) onResult(found);
    }, delayMs);
  }

  return { input, cancel };
}
