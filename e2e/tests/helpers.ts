import { type Browser, expect, type Locator, type Page } from "@playwright/test";

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
  await fillJapanese(page.getByLabel("表示名"), name);
  // ログインの API(PUT /me)を送ったかも控える(届かなかったとき、どこで止まったかを出すため)
  const sentLogin = page
    .waitForRequest((req) => req.method() === "PUT" && new URL(req.url()).pathname === "/me", {
      timeout: 10_000,
    })
    .then(() => true)
    .catch(() => false);
  await page.getByRole("button", { name: "ログイン" }).click();
  const heading = page.getByRole("heading", { level: 1, name: "旅の一覧" });
  try {
    await expect(heading).toBeVisible();
  } catch (error) {
    const focused = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80));
    throw new Error(
      `ログインできなかった。API(PUT /me)を${(await sentLogin) ? "送った" : "送っていない"}。` +
        `フォーカス: ${focused}`,
      { cause: error },
    );
  }
  return page;
}

/**
 * 日本語を入れて、確定を済ませる。
 * Playwright の Firefox は日本語を「変換の確定」として入れる。遅い環境では確定の処理が終わる前に
 * 次のボタンを押すと、押下が確定の処理に吸われることがある(CI で一度、ログインの押下が届かなかった)。
 * 人と同じく、欄から出て確定を済ませてから次の操作をする。
 */
export async function fillJapanese(field: Locator, value: string) {
  await field.fill(value);
  await field.blur();
  await expect(field).toHaveValue(value);
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

/** 旅の画面のタブを開く */
export async function openTab(page: Page, name: "旅程" | "候補" | "割り勘" | "メンバー") {
  const link = page
    .getByRole("navigation", { name: "旅の画面の切り替え" })
    .getByRole("link", { name: new RegExp(`^${name}`) });
  await link.click();
  await expect(link).toHaveAttribute("aria-current", "page");
}

/** 確認のダイアログで、どちらかを押す */
export async function confirmIn(page: Page, name: string) {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name, exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** 候補タブを開いて、候補を出す */
export async function proposeIdea(page: Page, name: string) {
  await openTab(page, "候補");
  await page.getByLabel("候補の名前").fill(name);
  await page.getByRole("button", { name: "候補に出す" }).click();
  await expect(page.getByRole("button", { name: `旅程に入れる: ${name}` })).toBeVisible();
}

/** 割り勘タブで支出を記録する */
export async function expenseOf(page: Page, title: string, amount: number) {
  await page.getByLabel("内容").fill(title);
  await page.getByLabel("金額(円)").fill(String(amount));
  await page.getByRole("button", { name: "記録する" }).click();
  await expect(page.getByRole("button", { name: `削除: ${title}` })).toBeVisible();
}

export async function reloadAndWait(page: Page, title: string) {
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
}

/** 狭い画面では、一覧と地図を切り替える(広い画面では何もしない) */
async function switchView(page: Page, name: "一覧" | "地図") {
  await expect(page.locator(".plan-layout")).toBeVisible();
  const button = page.locator(".view-switch").getByRole("button", { name, exact: true });
  if (await button.isVisible()) await button.click();
}
export const showMap = (page: Page) => switchView(page, "地図");
export const showList = (page: Page) => switchView(page, "一覧");

/** クリップボードの代わりに、書き込まれた文字を覚える(ブラウザごとの許可の違いを避ける) */
export async function stubClipboard(page: Page) {
  await page.evaluate(() => {
    const store = window as Window & { copied?: string };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          store.copied = text;
        },
      },
    });
  });
  return () => page.evaluate(() => (window as Window & { copied?: string }).copied);
}

/** 同じ人のまま、別のタブを開く */
export async function sameUserTab(page: Page, path: string) {
  const tab = await page.context().newPage();
  const session = await page.evaluate(() => sessionStorage.getItem("tritri-dev-user") ?? "");
  await tab.addInitScript((value) => sessionStorage.setItem("tritri-dev-user", value), session);
  await tab.goto(path);
  return tab;
}

/** Tab キーだけで、目的の部品まで移る */
export async function tabTo(page: Page, target: Locator, browserName: string) {
  await expect(target).toBeVisible();
  // macOS の Safari(WebKit)は、Alt+Tab でないとリンクとボタンに止まらない
  const key = browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab";
  for (let i = 0; i < 80; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press(key);
  }
  throw new Error("Tab キーで届かない");
}
