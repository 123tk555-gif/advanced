import { describe, expect, it, vi } from "vitest";
import { createAuthFailureWatcher } from "./auth";

/** Google はキーの誤り・制限違反を、例外ではなく window.gm_authFailure の呼び出しで知らせる */
describe("createAuthFailureWatcher", () => {
  it("Google から知らせが来たら、待っている画面に伝える", () => {
    const target: { gm_authFailure?: () => void } = {};
    const watcher = createAuthFailureWatcher(target);
    const listener = vi.fn();
    watcher.watch(listener);
    expect(listener).not.toHaveBeenCalled();
    target.gm_authFailure?.();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("知らせの後に開いた画面にも、すぐ伝える(Google は 1 回しか知らせないため)", () => {
    const target: { gm_authFailure?: () => void } = {};
    const watcher = createAuthFailureWatcher(target);
    target.gm_authFailure?.();
    const listener = vi.fn();
    watcher.watch(listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("見るのをやめた画面には伝えない", () => {
    const target: { gm_authFailure?: () => void } = {};
    const watcher = createAuthFailureWatcher(target);
    const listener = vi.fn();
    watcher.watch(listener)();
    target.gm_authFailure?.();
    expect(listener).not.toHaveBeenCalled();
  });
});
