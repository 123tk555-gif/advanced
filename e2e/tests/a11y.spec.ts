import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import {
  addItem,
  createTrip,
  expenseOf,
  inviteUrl,
  openAs,
  openTab,
  proposeIdea,
  tabTo,
} from "./helpers.js";

/** 見やすさ: axe の自動検査・横はみ出し・キーボードだけの操作 */

async function check(page: Page, screen: string) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const serious = result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map(
      (v) =>
        `${v.id}: ${v.nodes
          .map((n) => n.target.join(" "))
          .slice(0, 4)
          .join(" | ")}`,
    );
  expect.soft(serious, `axe: ${screen}`).toEqual([]);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect.soft(overflow, `横はみ出し: ${screen}`).toBeLessThanOrEqual(1);
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`すべての画面に重大な指摘が無い(${colorScheme})`, async ({ browser }) => {
    test.setTimeout(150_000);
    const page = await openAs(browser, "長い名前のたろうさん");
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await check(page, "旅の一覧(空)");
    await page.getByRole("link", { name: "旅を作る" }).click();
    await check(page, "旅を作る");
    await page.getByRole("button", { name: "作る" }).click();
    await expect(page.getByText("タイトルを入力してください")).toBeVisible();
    await check(page, "旅を作る(誤り)");
    await page.getByRole("link", { name: "旅の一覧" }).click();

    await createTrip(page, "見やすさを確かめる長めの題名の旅");
    const url = page.url();
    await addItem(page, 1, "京都駅に集合", "京都駅");
    await check(page, "旅程");
    await page.getByRole("button", { name: "編集: 京都駅に集合" }).click();
    await check(page, "予定のダイアログ");
    await page.getByRole("dialog").getByRole("button", { name: "やめる" }).click();
    await page.getByRole("button", { name: "削除: 京都駅に集合" }).click();
    await check(page, "確認のダイアログ");
    await page.getByRole("dialog").getByRole("button", { name: "やめる" }).click();

    await proposeIdea(page, "平等院");
    await check(page, "候補");
    await openTab(page, "割り勘");
    await expenseOf(page, "長い名前のお店での晩ごはんと飲み物", 1_234_567);
    await check(page, "割り勘");
    const invite = await inviteUrl(page);
    await check(page, "メンバー");
    await page.goto(`${url}/settings`);
    await page.getByRole("button", { name: "公開リンクを発行する" }).click();
    await expect(page.getByLabel("公開リンク")).toBeVisible();
    await check(page, "旅の設定");
    const publicUrl = await page.getByLabel("公開リンク").inputValue();
    await page.goto("/trips");
    await check(page, "旅の一覧");
    await page.goto("/settings");
    await check(page, "アカウント設定");
    await page.goto("/no-such-page");
    await check(page, "見つかりません");

    const guest = await openAs(browser, "はなこ");
    await guest.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await guest.goto(invite);
    await expect(guest.getByRole("heading", { name: "旅への招待" })).toBeVisible();
    await check(guest, "招待");

    const visitor = await (await browser.newContext({ colorScheme })).newPage();
    await visitor.goto(publicUrl);
    await expect(visitor.getByText("これは公開しおりです")).toBeVisible();
    await check(visitor, "公開しおり");
    await visitor.goto("/login");
    await check(visitor, "ログイン");
  });
}

test("キーボードだけで、ログインから予定の追加・編集・削除までできる", async ({
  page,
  browserName,
}) => {
  test.setTimeout(90_000);
  await page.goto("/login");
  const go = (target: ReturnType<Page["locator"]>) => tabTo(page, target, browserName);
  await go(page.getByLabel("利用者 ID"));
  await page.keyboard.type(`keys-${Date.now()}`);
  await go(page.getByLabel("表示名"));
  await page.keyboard.type("keys");
  await page.keyboard.press("Enter");

  await go(page.getByRole("link", { name: "旅を作る" }));
  await page.keyboard.press("Enter");
  await go(page.getByLabel(/^タイトル/));
  await page.keyboard.type("keyboard trip");
  await go(page.locator("#tf-start"));
  await page.keyboard.type("20270401");
  await go(page.locator("#tf-end"));
  await page.keyboard.type("20270402");
  await page.keyboard.press("Enter");

  await go(page.getByRole("button", { name: /予定を追加.*1日目/ }));
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel(/^タイトル/)).toBeFocused();
  await page.keyboard.type("plan");
  await go(dialog.getByRole("combobox", { name: /場所/ }));
  await page.keyboard.insertText("京都駅");
  await expect(dialog.getByRole("option", { name: /京都駅/ }).first()).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("textbox", { name: /場所/ })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();

  const edit = page.getByRole("button", { name: "編集: plan" });
  await go(edit);
  const outline = await edit.evaluate((el) => {
    const style = getComputedStyle(el);
    return style.outlineStyle !== "none" || style.boxShadow !== "none";
  });
  expect(outline, "フォーカスの枠が見える").toBe(true);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(edit).toBeFocused();

  await go(page.getByRole("button", { name: "削除: plan" }));
  await page.keyboard.press("Enter");
  await go(dialog.getByRole("button", { name: "削除する" }));
  await page.keyboard.press("Enter");
  await expect(page.locator(".item-title")).toHaveCount(0);
});
