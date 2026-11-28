import AxeBuilder from "@axe-core/playwright";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "../tests/fixtures.js";
import { createTrip, fillJapanese, joinAndApprove, openTab } from "../tests/helpers.js";

/**
 * メールアドレスとパスワードのログイン(画面一覧 S01〜S04)。
 * Cognito の代わりに試験用のログインを使う(確認コードは常に 123456、メールは送らない)。
 */
const CODE = "123456";
const PASSWORD = "tabi-no-shiori-1";
let n = 0;
const newEmail = () => `user${Date.now()}${n++}@example.com`;

async function signUp(page: Page, email: string, name: string, password = PASSWORD) {
  await page.goto("/signup");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel(/^パスワード/).fill(password);
  await fillJapanese(page.getByLabel(/^表示名/), name);
  await page.getByRole("button", { name: "登録して確認コードを送る" }).click();
  await expect(page.getByRole("heading", { name: "確認コードの入力" })).toBeVisible();
  await expect(page.getByLabel("メールアドレス")).toHaveValue(email);
}

async function confirm(page: Page) {
  await page.getByLabel(/^確認コード/).fill(CODE);
  await page.getByRole("button", { name: "確認する" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "ログイン" })).toBeVisible();
}

async function logIn(page: Page, email: string, password = PASSWORD) {
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel("パスワード").fill(password);
  await page.getByRole("button", { name: "ログイン" }).click();
}

/** 会員登録からログインまで済ませた画面 */
async function member(browser: Browser, name: string) {
  const page = await (await browser.newContext()).newPage();
  const email = newEmail();
  await signUp(page, email, name);
  await confirm(page);
  await logIn(page, email);
  await expect(page.getByRole("heading", { level: 1, name: "旅の一覧" })).toBeVisible();
  return { page, email };
}

test("会員登録 → 確認コード → ログインで、登録した表示名で旅の一覧に入れる", async ({
  browser,
}) => {
  const { page } = await member(browser, "たろう");
  await expect(page.getByRole("link", { name: "たろう さん" })).toBeVisible();
  await expect(page.getByText("たろう さんとしてログインしました")).toBeVisible();
});

test("ログインしていなければログイン画面へ。ログインすると、開こうとした画面に戻る", async ({
  browser,
}) => {
  const page = await (await browser.newContext()).newPage();
  const email = newEmail();
  await signUp(page, email, "はなこ");
  await confirm(page);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login\?returnTo=(%2F|\/)settings$/);
  await logIn(page, email);
  await expect(page.getByRole("heading", { name: "アカウント設定" })).toBeVisible();
});

test("違うパスワード・違う確認コード・登録済みのメール・短いパスワードは、わかる言葉で断る", async ({
  browser,
}) => {
  const page = await (await browser.newContext()).newPage();
  const email = newEmail();
  await signUp(page, email, "じろう");
  await page.getByLabel(/^確認コード/).fill("000000");
  await page.getByRole("button", { name: "確認する" }).click();
  await expect(page.getByRole("alert")).toContainText("確認コードが違います");
  await confirm(page);

  await logIn(page, email, "wrong-password");
  await expect(page.getByRole("alert")).toContainText("メールアドレスかパスワードが違います");
  await logIn(page, "nobody@example.com");
  await expect(page.getByRole("alert")).toContainText("メールアドレスかパスワードが違います");

  await page.goto("/signup");
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByLabel(/^パスワード/).fill("short");
  await page.getByLabel(/^表示名/).fill("じろう");
  await page.getByRole("button", { name: "登録して確認コードを送る" }).click();
  await expect(page.getByRole("alert")).toContainText("パスワードは 10 文字以上にしてください");
  await page.getByLabel(/^パスワード/).fill(PASSWORD);
  await page.getByRole("button", { name: "登録して確認コードを送る" }).click();
  await expect(page.getByRole("alert")).toContainText("このメールアドレスは登録済みです");
});

test("確認コードを入れずにログインしようとすると、確認コードの画面へ案内する", async ({
  browser,
}) => {
  const page = await (await browser.newContext()).newPage();
  const email = newEmail();
  await signUp(page, email, "さぶろう");
  await page.goto("/login");
  await logIn(page, email);
  await expect(page.getByRole("alert")).toContainText("メールアドレスの確認がまだです");
  await page.getByRole("link", { name: "確認コードを入れる画面へ" }).click();
  await expect(page.getByRole("heading", { name: "確認コードの入力" })).toBeVisible();
  await expect(page.getByLabel("メールアドレス")).toHaveValue(email);
  await page.getByRole("button", { name: "コードを送り直す" }).click();
  await expect(page.getByText("確認コードを送り直しました")).toBeVisible();
  await confirm(page);
  await logIn(page, email);
  await expect(page.getByRole("heading", { level: 1, name: "旅の一覧" })).toBeVisible();
});

test("パスワードを再設定すると、新しいパスワードでだけ入れる", async ({ browser }) => {
  const { page, email } = await member(browser, "しろう");
  await page.goto("/settings");
  await page.getByRole("button", { name: "ログアウト" }).click();
  await page.getByRole("link", { name: "パスワードを忘れた方" }).click();
  await expect(page.getByRole("heading", { name: "パスワードの再設定" })).toBeVisible();
  await page.getByLabel("メールアドレス").fill(email);
  await page.getByRole("button", { name: "確認コードを送る" }).click();
  await page.getByLabel(/^確認コード/).fill(CODE);
  await page.getByLabel(/^新しいパスワード/).fill("atarashii-pass-2");
  await page.getByRole("button", { name: "パスワードを変える" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "ログイン" })).toBeVisible();

  await logIn(page, email);
  await expect(page.getByRole("alert")).toContainText("メールアドレスかパスワードが違います");
  await logIn(page, email, "atarashii-pass-2");
  await expect(page.getByRole("heading", { level: 1, name: "旅の一覧" })).toBeVisible();
});

test("登録していないメールでの再設定も、登録済みと同じに見える(登録の有無を知られない)", async ({
  browser,
}) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/password-reset");
  await page.getByLabel("メールアドレス").fill("nobody@example.com");
  await page.getByRole("button", { name: "確認コードを送る" }).click();
  await expect(page.getByText("が登録されていれば、6 桁の確認コードを送りました")).toBeVisible();
});

test("表示名が無いまま入ったら、表示名の登録の画面で決めてから使える", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  const email = newEmail();
  await signUp(page, email, "ごろう");
  // 別のタブで登録したなど、持ち越した表示名が無いとき
  await page.evaluate(() => sessionStorage.removeItem("tritri-pending-name"));
  await confirm(page);
  await logIn(page, email);
  await expect(page.getByRole("heading", { name: "表示名の登録" })).toBeVisible();
  await page.goto("/trips");
  await expect(page.getByRole("heading", { name: "表示名の登録" })).toBeVisible();
  await page.getByLabel(/^表示名/).fill("ごろう");
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "旅の一覧" })).toBeVisible();
  await expect(page.getByRole("link", { name: "ごろう さん" })).toBeVisible();
});

test("再読み込みしてもログインしたまま。ログアウトすると旅の画面は開けない", async ({
  browser,
}) => {
  const { page } = await member(browser, "ろくろう");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "旅の一覧" })).toBeVisible();
  await expect(page.getByRole("link", { name: "ろくろう さん" })).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "ログイン" })).toBeVisible();
  await page.goto("/trips");
  await expect(page.getByRole("heading", { level: 1, name: "ログイン" })).toBeVisible();
});

test("退会すると、同じメールアドレスとパスワードでは入れない", async ({ browser }) => {
  const { page, email } = await member(browser, "ななこ");
  await page.goto("/settings");
  await page.getByRole("button", { name: "退会する" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "退会する" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "ログイン" })).toBeVisible();
  await logIn(page, email);
  await expect(page.getByRole("alert")).toContainText("メールアドレスかパスワードが違います");
});

test("ログインした人どうしで、招待して旅を一緒に使える", async ({ browser }) => {
  const taro = await member(browser, "たろう");
  const hanako = await member(browser, "はなこ");
  await createTrip(taro.page, "メールの人の旅");
  await openTab(taro.page, "メンバー");
  await joinAndApprove(taro.page, hanako.page, "はなこ");
  // 承認待ちの画面は 5 秒ごとに確かめ、承認されると旅の画面に切り替わる
  await expect(hanako.page.getByRole("heading", { level: 1, name: "メールの人の旅" })).toBeVisible({
    timeout: 20_000,
  });
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`ログイン・会員登録の画面に、見やすさの重大な指摘が無い(${colorScheme})`, async ({
    browser,
  }) => {
    const page = await (await browser.newContext({ colorScheme })).newPage();
    const check = async (screen: string) => {
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      const serious = result.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.id}: ${v.nodes.map((x) => x.target.join(" ")).join(" | ")}`);
      expect.soft(serious, `axe: ${screen}`).toEqual([]);
    };
    await page.goto("/login");
    await page.getByRole("button", { name: "ログイン" }).click();
    await expect(page.getByRole("alert")).toContainText("メールアドレスを入力してください");
    await check("ログイン(誤り)");
    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: "会員登録" })).toBeVisible();
    await check("会員登録");
    await page.goto("/signup/confirm?email=a%40example.com");
    await expect(page.getByRole("heading", { name: "確認コードの入力" })).toBeVisible();
    await check("確認コードの入力");
    await page.goto("/password-reset");
    await expect(page.getByRole("heading", { name: "パスワードの再設定" })).toBeVisible();
    await check("パスワードの再設定");
    const email = newEmail();
    await signUp(page, email, "ごろう");
    await page.evaluate(() => sessionStorage.removeItem("tritri-pending-name"));
    await confirm(page);
    await logIn(page, email);
    await expect(page.getByRole("heading", { name: "表示名の登録" })).toBeVisible();
    await check("表示名の登録");
  });
}
