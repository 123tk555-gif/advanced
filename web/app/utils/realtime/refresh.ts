/** 変更の合図が届いてから読み直すまで(続けて届いた合図をまとめる) */
export const REFRESH_DELAY_MS = 250;

/**
 * 旅の読み直しを 1 本にまとめる。
 * - 続けて届いた合図は 1 回にまとめる
 * - 読み直しは重ねない(古い答えが新しい答えを上書きしないように)
 * - blocked(ダイアログ中・日本語の変換中)の間は待ち、resume で読み直す
 */
export function createRefresher(load: () => Promise<void>, blocked: () => boolean) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let pending = false;
  /** 次の読み直しは blocked でも待たない(自分の変更) */
  let urgent = false;
  let stopped = false;

  function run() {
    clearTimeout(timer);
    timer = undefined;
    if (stopped || running || !pending) return;
    if (!urgent && blocked()) return;
    pending = false;
    urgent = false;
    running = true;
    const done = () => {
      running = false;
      run();
    };
    load().then(done, done);
  }

  function schedule() {
    timer ??= setTimeout(run, REFRESH_DELAY_MS);
  }

  return {
    /** ほかの人の変更の合図 */
    request() {
      pending = true;
      schedule();
    },
    /** 自分の変更。待たずに読む */
    now() {
      pending = true;
      urgent = true;
      run();
    },
    /** ダイアログが閉じた・変換が終わった */
    resume() {
      if (pending) schedule();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
