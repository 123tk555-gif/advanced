import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";

/**
 * テストはすべて、ここの test を使う。
 * ブラウザ(browser)は同じワーカーのテストで使い回すので、テストの中で
 * browser.newContext() や openAs() で開いた画面は、テストの後に閉じる
 * (閉じないと、画面とリアルタイム更新の接続が溜まり、後のテストほど遅くなる)。
 */
export const test = base.extend<{ closeOpenedContexts: undefined }>({
  closeOpenedContexts: [
    async ({ browser }, use) => {
      const before = new Set(browser.contexts());
      await use(undefined);
      await Promise.all(
        browser
          .contexts()
          .filter((context) => !before.has(context))
          .map((context) => context.close().catch(() => {})),
      );
    },
    { auto: true },
  ],
});
