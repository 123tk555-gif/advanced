import { expect, test } from "./fixtures.js";
import { openAs } from "./helpers.js";

// テストが開いた画面(コンテキスト)は、そのテストの後に閉じる。
// 閉じないと、ブラウザを使い回す間に画面とリアルタイム更新の接続が溜まり続け、
// 後のテストほど遅くなる(CI では実行環境ごと止まった)
test.describe
  .serial("テストの後片付け", () => {
    test("画面を開く", async ({ browser }) => {
      await openAs(browser, "片付け");
      await (await browser.newContext()).newPage();
      expect(browser.contexts().length).toBeGreaterThanOrEqual(2);
    });

    test("前のテストで開いた画面が残っていない", async ({ browser }) => {
      expect(browser.contexts()).toHaveLength(0);
    });
  });
