/**
 * Google マップのキーの誤り・制限違反を受け取る。
 * Google はこれを例外にせず、window.gm_authFailure を 1 回呼んで知らせる。
 * そのため、地図を読み込む前に受け口を置き、知らせが来たことを覚えておく。
 */
export function createAuthFailureWatcher(target: { gm_authFailure?: () => void }) {
  let failed = false;
  const listeners = new Set<() => void>();
  target.gm_authFailure = () => {
    failed = true;
    for (const listener of listeners) listener();
  };

  /** 戻り値を呼ぶと、見るのをやめる */
  function watch(listener: () => void): () => void {
    listeners.add(listener);
    if (failed) listener();
    return () => {
      listeners.delete(listener);
    };
  }

  return { watch };
}
