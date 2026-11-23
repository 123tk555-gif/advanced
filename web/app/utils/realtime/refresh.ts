/** 変更の合図が届いてから読み直すまで(続けて届いた合図をまとめる) */
export const REFRESH_DELAY_MS = 250;
/**
 * ほかの人の変更による読み直しの最短の間隔。
 * 50 人が見ている旅で変更が続くと、全員が全件を読み直して DB の読み取りの上限を超えるため(負荷試験 L5)
 */
export const MIN_INTERVAL_MS = 2000;
/** 全員が同じ瞬間に読まないよう、ずらす幅(この範囲でばらつかせる) */
export const SPREAD_MS = 500;

/**
 * 旅の読み直しを 1 本にまとめる。
 * - 続けて届いた合図は 1 回にまとめる。前の読み直しから MIN_INTERVAL_MS はあける
 * - 読み直しは重ねない(古い答えが新しい答えを上書きしないように)
 * - blocked(ダイアログ中・日本語の変換中)の間は待ち、resume で読み直す
 * - 自分の変更(now)は待たずに読む
 */
export function createRefresher(
  load: () => Promise<void>,
  blocked: () => boolean,
  { random = Math.random, clock = Date.now } = {},
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let pending = false;
  /** 次の読み直しは blocked でも、間隔に関係なく行う(自分の変更) */
  let urgent = false;
  let stopped = false;
  let lastStart = Number.NEGATIVE_INFINITY;

  function run() {
    clearTimeout(timer);
    timer = undefined;
    if (stopped || running || !pending) return;
    if (!urgent && blocked()) return;
    if (!urgent && clock() - lastStart < MIN_INTERVAL_MS) {
      schedule();
      return;
    }
    pending = false;
    urgent = false;
    running = true;
    lastStart = clock();
    const done = () => {
      running = false;
      if (pending) schedule();
    };
    load().then(done, done);
  }

  function schedule() {
    if (timer !== undefined || running) return;
    const settle = REFRESH_DELAY_MS + Math.floor(random() * SPREAD_MS);
    const wait = Math.max(settle, lastStart + MIN_INTERVAL_MS - clock());
    timer = setTimeout(run, wait);
  }

  return {
    /** ほかの人の変更の合図 */
    request() {
      pending = true;
      schedule();
    },
    /** 自分の変更。待たずに読む(読み直し中なら、終わってすぐ) */
    now() {
      pending = true;
      urgent = true;
      if (running) return;
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
