import { type Browser, expect, type Page } from "@playwright/test";

/** テストごとに重ならない利用者 ID を作る(テーブルは実行をまたいで残るため) */
export function uniqueId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 新しいブラウザ(別の人)を開き、開発用ログインで入る。
 * 本番では Cognito のログインになるが、手元では利用者 ID と表示名を入れるだけで入れる。
 */
export async function openAs(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("利用者 ID").fill(uniqueId("u"));
  await page.getByLabel("表示名").fill(name);
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "旅の一覧" })).toBeVisible();
  return page;
}

/** 旅を作り、その旅の画面を開いた状態にする */
export async function createTrip(page: Page, title: string) {
  await page.getByRole("link", { name: "旅を作る" }).click();
  await page.getByLabel("タイトル").fill(title);
  await page.getByRole("textbox", { name: /^開始日/ }).fill("2027/04/01");
  await page.getByRole("textbox", { name: /^終了日/ }).fill("2027/04/03");
  await page.getByLabel("行き先").fill("京都");
  await page.getByRole("button", { name: "作る" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

/** 旅程に予定を足す(場所は候補から選ぶ) */
export async function addItem(page: Page, day: number, title: string, placeQuery?: string) {
  await page.getByRole("button", { name: new RegExp(`予定を追加.*${day}日目`) }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("タイトル").fill(title);
  if (placeQuery) {
    await dialog.getByRole("combobox", { name: /場所/ }).fill(placeQuery);
    // 「日にち」の選択肢も option なので、場所の候補の一覧に絞る
    await dialog.getByRole("listbox", { name: "場所の候補" }).getByRole("option").first().click();
  }
  await dialog.getByRole("button", { name: "保存する" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".item-title", { hasText: title })).toBeVisible();
}

/** 招待リンクを取り出す(メンバータブの入力欄) */
export async function inviteUrl(page: Page) {
  await page.getByRole("link", { name: /^メンバー/ }).click();
  return page.getByLabel("招待リンク").inputValue();
}

/** guest が招待リンクから申請し、owner が承認する */
export async function joinAndApprove(owner: Page, guest: Page, guestName: string) {
  const url = await inviteUrl(owner);
  await guest.goto(url);
  await guest.getByRole("button", { name: "参加を申請する" }).click();
  await expect(guest.getByText("参加を申請しました")).toBeVisible();

  await owner.reload();
  await owner.getByRole("button", { name: `承認: ${guestName}` }).click();
  await expect(owner.getByRole("button", { name: `承認: ${guestName}` })).toBeHidden();
}
