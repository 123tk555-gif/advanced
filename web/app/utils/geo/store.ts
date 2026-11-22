/** 問い合わせの状態(画面に出す形) */
export type LookupState<T> =
  | { status: "loading" }
  | { status: "ok"; value: T }
  | { status: "none" }
  | { status: "failed" };

/** 失敗した問い合わせを、やり直してよくなるまでの時間 */
export const RETRY_AFTER_MS = 60_000;

/**
 * 問い合わせの結果を、画面を開いている間だけ覚えておく仕組み(座標・区間の移動時間)。
 * Google への問い合わせは 1 回ごとに料金の枠を使うので、次の決まりを守る。
 * - 同じキーの問い合わせは 1 回にまとめる
 * - 「無い」という答えは覚える
 * - 失敗も RETRY_AFTER_MS の間は覚える。すぐやり直すと、
 *   失敗の知らせ → 画面の再計算 → 問い合わせ → 失敗 …と止まらなくなる
 */
export function createLookupStore<T>(
  load: (key: string) => Promise<T | null>,
  notify: () => void,
  now: () => number = Date.now,
) {
  const known = new Map<string, LookupState<T>>();
  const failedAt = new Map<string, number>();

  function get(key: string): LookupState<T> {
    const state = known.get(key);
    if (state) {
      const at = failedAt.get(key);
      if (at === undefined || now() - at < RETRY_AFTER_MS) return state;
    }

    failedAt.delete(key);
    const loading: LookupState<T> = { status: "loading" };
    known.set(key, loading);
    load(key).then(
      (value) => {
        known.set(key, value === null ? { status: "none" } : { status: "ok", value });
        notify();
      },
      () => {
        known.set(key, { status: "failed" });
        failedAt.set(key, now());
        notify();
      },
    );
    return loading;
  }

  function put(key: string, value: T) {
    known.set(key, { status: "ok", value });
    failedAt.delete(key);
    notify();
  }

  return { get, put };
}
