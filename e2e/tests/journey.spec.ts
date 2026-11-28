import { expect, test } from "./fixtures.js";
import {
  addItem,
  confirmIn,
  createTrip,
  expenseOf,
  joinAndApprove,
  openAs,
  openTab,
  proposeIdea,
} from "./helpers.js";

test("一連の流れ: 作成 → 招待 → 計画 → 投票 → 割り勘 → 公開 → 引き継ぎ → 退会", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const taro = await openAs(browser, "たろう");
  const hanako = await openAs(browser, "はなこ");
  const jiro = await openAs(browser, "じろう");

  await createTrip(taro, "三人の京都");
  const url = taro.url();
  await joinAndApprove(taro, hanako, "はなこ");
  await joinAndApprove(taro, jiro, "じろう");
  for (const page of [taro, hanako, jiro]) await page.goto(url);

  await addItem(taro, 1, "京都駅に集合", "京都駅");
  await expect(jiro.locator(".item-title")).toHaveText(["京都駅に集合"]);

  await proposeIdea(hanako, "平等院");
  await openTab(jiro, "候補");
  await jiro.getByRole("button", { name: "行きたい!: 平等院" }).click();
  await expect(hanako.locator(".votes")).toHaveText("1 票");
  await hanako.getByRole("button", { name: "旅程に入れる: 平等院" }).click();
  await hanako
    .getByRole("dialog")
    .getByRole("button", { name: /入れる/ })
    .click();
  await expect(taro.locator(".item-title")).toHaveText(["京都駅に集合", "平等院"]);

  await openTab(taro, "割り勘");
  await expenseOf(taro, "昼ごはん", 3000);
  await openTab(jiro, "割り勘");
  await expect(jiro.locator(".list-plain .money")).toHaveText(["1,000 円", "1,000 円"]);

  await taro.getByRole("link", { name: "旅の設定" }).click();
  await taro.getByRole("button", { name: "公開リンクを発行する" }).click();
  const publicUrl = await taro.getByLabel("公開リンク").inputValue();
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(publicUrl);
  await expect(visitor.locator(".item-title")).toHaveText(["京都駅に集合", "平等院"]);
  await expect(visitor.getByText("昼ごはん")).toHaveCount(0);

  await taro.getByLabel("オーナーを引き継ぐ").selectOption({ label: "はなこ" });
  await taro.getByRole("button", { name: "引き継ぐ", exact: true }).click();
  await confirmIn(taro, "引き継ぐ");
  await expect(taro.getByRole("button", { name: "この旅から抜ける" })).toBeVisible();

  await taro.getByRole("link", { name: "たろう さん" }).click();
  await taro.getByRole("button", { name: "退会する" }).click();
  await confirmIn(taro, "退会する");
  await expect(taro).toHaveURL(/\/login/);

  await openTab(hanako, "メンバー");
  await expect(hanako.getByText("退会した会員").first()).toBeVisible();
  await expect(hanako.locator(".row", { hasText: "はなこ" })).toContainText("オーナー");
  // 精算は退会しても残る
  await expect(jiro.locator(".list-plain .money")).toHaveText(["1,000 円", "1,000 円"]);
  await visitor.reload();
  await expect(visitor.getByText(/退会した会員/)).toBeVisible();
});
