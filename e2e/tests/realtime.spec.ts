import { type Browser, expect, type Page, test } from "@playwright/test";
import { addItem, createTrip, inviteUrl, joinAndApprove, openAs } from "./helpers.js";

/** リアルタイム更新。どのテストも再読み込みをせずに確かめる */

/** 変更が届くまでの上限(合図 + 読み直し) */
const SOON = { timeout: 3000 };

const presence = (page: Page) => page.getByRole("group", { name: "今見ている人" });
const tab = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "旅の画面の切り替え" }).getByRole("link", { name });

/** 2 人が同じ旅の旅程を開いて、つながっている状態 */
async function twoPeople(browser: Browser) {
  const taro = await openAs(browser, "たろう");
  await createTrip(taro, "みんなの旅");
  const tripUrl = taro.url();
  const hanako = await openAs(browser, "はなこ");
  await joinAndApprove(taro, hanako, "はなこ");
  await taro.goto(tripUrl);
  await hanako.goto(tripUrl);
  for (const page of [taro, hanako]) {
    await expect(presence(page)).toContainText("たろう");
    await expect(presence(page)).toContainText("はなこ");
  }
  return { taro, hanako, tripUrl };
}

test("予定・候補と投票・割り勘・コメントが、再読み込みなしで届く", async ({ browser }) => {
  const { taro, hanako } = await twoPeople(browser);

  await addItem(taro, 1, "朝の散歩");
  await expect(hanako.locator(".item-title")).toHaveText(["朝の散歩"], SOON);

  await taro.locator("summary").click();
  await taro.getByLabel(/^コメント/).fill("楽しみです");
  await taro.getByRole("button", { name: "送る" }).click();
  await expect(hanako.locator("summary")).toContainText("(1)", SOON);

  await tab(taro, "候補").click();
  await tab(hanako, "候補").click();
  await taro.getByLabel("候補の名前").fill("平等院");
  await taro.getByRole("button", { name: "候補に出す" }).click();
  await expect(hanako.locator("li", { hasText: "平等院" })).toBeVisible(SOON);
  await hanako.getByRole("button", { name: "行きたい!: 平等院" }).click();
  await expect(taro.locator(".votes")).toHaveText("1 票", SOON);

  await tab(taro, "割り勘").click();
  await tab(hanako, "割り勘").click();
  await taro.getByLabel("内容").fill("昼ごはん");
  await taro.getByLabel("金額(円)").fill("3000");
  await taro.getByRole("button", { name: "記録する" }).click();
  await expect(hanako.getByRole("cell", { name: /^昼ごはん/ })).toBeVisible(SOON);
});

test("今見ている人に出て、画面を離れると消える", async ({ browser }) => {
  const { taro, hanako } = await twoPeople(browser);
  await hanako.getByRole("link", { name: "旅の一覧" }).click();
  await expect(presence(taro)).not.toContainText("はなこ", SOON);
});

test("編集中の表示が一覧とダイアログに出て、終えると消える", async ({ browser }) => {
  const { taro, hanako } = await twoPeople(browser);
  await addItem(taro, 1, "お参り");
  await expect(hanako.locator(".item-title")).toHaveText(["お参り"], SOON);

  await hanako.getByRole("button", { name: "編集: お参り" }).click();
  await expect(taro.locator(".item")).toContainText("はなこさんが編集中", SOON);
  // 自分の編集中は、自分には出さない
  await expect(hanako.locator(".item")).not.toContainText("編集中");

  await taro.getByRole("button", { name: "編集: お参り" }).click();
  await expect(taro.getByRole("dialog")).toContainText("はなこさんが編集中", SOON);

  await hanako.getByRole("dialog").getByRole("button", { name: "やめる" }).click();
  await expect(taro.getByRole("dialog")).not.toContainText("編集中", SOON);
});

test("ダイアログを開いている間の変更は、閉じたときに届く", async ({ browser }) => {
  const { taro, hanako } = await twoPeople(browser);
  await hanako.getByRole("button", { name: /予定を追加.*1日目/ }).click();
  await addItem(taro, 1, "閉じたら出る");
  await hanako.waitForTimeout(1500);
  await expect(hanako.locator(".item-title")).toHaveCount(0);
  await hanako.getByRole("dialog").getByRole("button", { name: "やめる" }).click();
  await expect(hanako.locator(".item-title")).toHaveText(["閉じたら出る"], SOON);
});

test("入力中に並べ替えが届いても、文字・カーソル・フォーカスが残る", async ({ browser }) => {
  const { taro, hanako } = await twoPeople(browser);
  await addItem(taro, 1, "A");
  await addItem(taro, 1, "B");
  await expect(hanako.locator(".item-title")).toHaveText(["A", "B"], SOON);

  const item = hanako.locator(".item", { hasText: "B" });
  await item.locator("summary").click();
  const box = item.getByLabel(/^コメント/);
  await box.fill("書きかけ");
  await box.press("ArrowLeft");

  await taro.getByRole("button", { name: "「B」を上へ" }).click();
  await expect(hanako.locator(".item-title")).toHaveText(["B", "A"], SOON);
  await expect(box).toBeFocused();
  await expect(box).toHaveValue("書きかけ");
  expect(await box.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(3);
});

test("日本語の変換中は読み直しを待つ", async ({ browser }) => {
  const { taro, hanako } = await twoPeople(browser);
  const main = hanako.locator("#main");
  await main.dispatchEvent("compositionstart");
  await addItem(taro, 1, "変換が終わったら出る");
  await hanako.waitForTimeout(1500);
  await expect(hanako.locator(".item-title")).toHaveCount(0);
  await main.dispatchEvent("compositionend");
  await expect(hanako.locator(".item-title")).toHaveText(["変換が終わったら出る"], SOON);
});

test("申請がすぐ届き、割り勘の入力中に入った人も分け合う人に入る", async ({ browser }) => {
  const taro = await openAs(browser, "たろう");
  await createTrip(taro, "人が増える旅");
  const tripUrl = taro.url();
  const url = await inviteUrl(taro);

  await taro.goto(`${tripUrl}?tab=money`);
  await expect(presence(taro)).toContainText("たろう");
  await taro.getByLabel("内容").fill("入力中の支出");

  const hanako = await openAs(browser, "はなこ");
  await hanako.goto(url);
  await hanako.getByRole("button", { name: "参加を申請する" }).click();
  await expect(taro.getByLabel("未処理の参加申請 1 件")).toBeVisible(SOON);

  // 同じオーナーの別タブで承認する
  const other = await taro.context().newPage();
  const session = await taro.evaluate(() => sessionStorage.getItem("tritri-dev-user") ?? "");
  await other.addInitScript((value) => sessionStorage.setItem("tritri-dev-user", value), session);
  await other.goto(`${tripUrl}?tab=members`);
  await other.getByRole("button", { name: "承認: はなこ" }).click();

  await expect(taro.getByRole("checkbox", { name: "はなこ" })).toBeChecked(SOON);
  await expect(taro.getByLabel("内容")).toHaveValue("入力中の支出");
});

test("外された人の画面から、しおりが消える", async ({ browser }) => {
  const { taro, hanako } = await twoPeople(browser);
  await addItem(taro, 1, "秘密の予定");
  await expect(hanako.locator(".item-title")).toHaveText(["秘密の予定"], SOON);

  await taro.getByRole("link", { name: "旅の設定" }).click();
  await taro.getByRole("button", { name: /外す/ }).click();
  await taro.getByRole("dialog").getByRole("button", { name: "外す" }).click();
  await expect(hanako.getByText("秘密の予定")).toHaveCount(0, SOON);
  await expect(hanako.getByText("見つかりません").first()).toBeVisible();
});

test("自分の表示名の変更が、ほかの人の画面に届く", async ({ browser }) => {
  const { taro, hanako } = await twoPeople(browser);
  const other = await hanako.context().newPage();
  const session = await hanako.evaluate(() => sessionStorage.getItem("tritri-dev-user") ?? "");
  await other.addInitScript((value) => sessionStorage.setItem("tritri-dev-user", value), session);
  await other.goto("/settings");
  await other.getByLabel(/^表示名/).fill("はな");
  await other.getByRole("button", { name: /保存/ }).click();
  await expect(presence(taro)).not.toContainText("はなこ", SOON);
  await expect(presence(taro)).toContainText("はな");
});

test("WebSocket を塞いでも「再接続中」と出て、15 秒ごとの読み直しで届く", async ({ browser }) => {
  const { taro, hanako, tripUrl } = await twoPeople(browser);
  await hanako.routeWebSocket(/\/ws\?/, (ws) => ws.close());
  await hanako.goto(tripUrl);
  await expect(hanako.getByText(/再接続中/)).toBeVisible();
  await addItem(taro, 1, "遅れて届く");
  await expect(hanako.locator(".item-title")).toHaveText(["遅れて届く"], { timeout: 20_000 });
});

test("切れても自動でつなぎ直し、その間の変更も届く", async ({ browser }) => {
  const { taro, hanako, tripUrl } = await twoPeople(browser);
  let blocked = true;
  await hanako.routeWebSocket(/\/ws\?/, (ws) => {
    if (blocked) ws.close();
    else ws.connectToServer();
  });
  await hanako.goto(tripUrl);
  await expect(hanako.getByText(/再接続中/)).toBeVisible();
  await addItem(taro, 1, "切れている間の予定");
  blocked = false;
  await expect(hanako.getByText("接続が戻りました")).toBeVisible();
  await expect(hanako.locator(".item-title")).toHaveText(["切れている間の予定"], SOON);
});
