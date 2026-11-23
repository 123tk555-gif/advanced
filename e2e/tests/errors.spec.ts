import { expect, type Page, test } from "@playwright/test";
import {
  addItem,
  confirmIn,
  createTrip,
  inviteUrl,
  openAs,
  openTab,
  sameUserTab,
} from "./helpers.js";

/** 失敗時・二重押し・開いたままの画面。「正しくはこう動く」を書いてある */

const API = "http://127.0.0.1:8788";

/** 指定した API の応答を、決めた内容に差し替える */
async function failWith(page: Page, method: string, path: RegExp, status: number, body: object) {
  await page.route(
    (url) => url.origin === API && path.test(url.pathname),
    (route) =>
      route.request().method() === method
        ? route.fulfill({
            status,
            contentType: "application/json",
            headers: { "access-control-allow-origin": "*" },
            body: JSON.stringify(body),
          })
        : route.fallback(),
  );
}

/** 指定した API を遅くして、届いた回数を数える(二重押しの確認) */
async function slowAndCount(page: Page, path: RegExp) {
  const seen = { count: 0 };
  await page.route(
    (url) => url.origin === API && path.test(url.pathname),
    async (route) => {
      if (route.request().method() === "POST") {
        seen.count += 1;
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      await route.continue();
    },
  );
  return seen;
}

test.describe("通信・サーバーの失敗", () => {
  test("通信断では、わかる言葉で知らせ、入力が残る", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await createTrip(page, "通信断の旅");
    await page.route(
      (url) => url.origin === API && url.pathname.endsWith("/items"),
      (route) => route.abort(),
    );
    await page.getByRole("button", { name: /予定を追加.*1日目/ }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/^タイトル/).fill("残る入力");
    await dialog.getByRole("button", { name: "保存する" }).click();
    await expect(dialog.getByText("サーバーにつながりません")).toBeVisible();
    await expect(dialog.getByLabel(/^タイトル/)).toHaveValue("残る入力");
  });

  const failures = [
    [500, "INTERNAL", "もう一度試してください"],
    [503, "BUSY", "混み合っています"],
    [409, "TOO_MANY_ITEMS", "300 件までです"],
    [413, "PAYLOAD_TOO_LARGE", "内容が大きすぎます"],
  ] as const;
  for (const [status, code, message] of failures) {
    test(`予定の保存が ${status} ${code}`, async ({ browser }) => {
      const page = await openAs(browser, "たろう");
      await createTrip(page, "失敗の旅");
      await failWith(page, "POST", /\/items$/, status, { error: code });
      await page.getByRole("button", { name: /予定を追加.*1日目/ }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(/^タイトル/).fill("残る入力");
      await dialog.getByRole("button", { name: "保存する" }).click();
      await expect(dialog.getByText(message)).toBeVisible();
      await expect(dialog.getByLabel(/^タイトル/)).toHaveValue("残る入力");
    });
  }

  test("旅の一覧が取れなければ、知らせる", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await failWith(page, "GET", /^\/trips$/, 500, { error: "INTERNAL" });
    await page.reload();
    await expect(page.getByText("もう一度試してください")).toBeVisible();
  });

  test("旅の設定が取れなければ、画面に残る形で知らせる", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await createTrip(page, "設定が取れない旅");
    await failWith(page, "GET", /^\/trips\/[^/]+$/, 500, { error: "INTERNAL" });
    await page.goto(`${page.url()}/settings`);
    await expect(page.locator("main").getByRole("alert")).toContainText("もう一度試してください");
  });

  test("消された予定を保存しようとしたら、知らせる", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await createTrip(page, "消された旅");
    await addItem(page, 1, "消される");
    await failWith(page, "PATCH", /\/items\//, 404, { error: "NOT_FOUND" });
    await page.getByRole("button", { name: "編集: 消される" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "保存する" }).click();
    await expect(page.getByText("ほかの人が削除しました")).toBeVisible();
  });
});

test.describe("入力の確認", () => {
  test("旅: 空・日付の前後・31 日", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await page.getByRole("link", { name: "旅を作る" }).click();
    await page.getByRole("button", { name: "作る" }).click();
    await expect(page.getByText("タイトルを入力してください")).toBeVisible();
    await page.getByLabel(/^タイトル/).fill("入力の旅");
    await page.locator("#tf-start").fill("2027/04/03");
    await page.locator("#tf-end").fill("2027/04/01");
    await page.getByRole("button", { name: "作る" }).click();
    await expect(page.getByText("終了日は開始日以降にしてください")).toBeVisible();
    await page.locator("#tf-end").fill("2027/05/03");
    await page.getByRole("button", { name: "作る" }).click();
    await expect(page.getByText("旅の日数は 30 日までです")).toBeVisible();
  });

  test("支出: 0 円・上限超え・分け合う人なし", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await createTrip(page, "金額の旅");
    await openTab(page, "割り勘");
    await page.getByLabel("内容").fill("支出");
    for (const amount of ["0", "10000001", "1.5"]) {
      await page.getByLabel("金額(円)").fill(amount);
      await page.getByRole("button", { name: "記録する" }).click();
      await expect(page.getByText("1 円以上 1000 万円以下の整数")).toBeVisible();
    }
    await page.getByRole("checkbox", { name: "たろう" }).uncheck();
    await page.getByRole("button", { name: "記録する" }).click();
    await expect(page.getByText("分け合う人を 1 人以上選んでください")).toBeVisible();
  });

  test("HTML は文字として出る(スクリプトは動かない)", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    let dialogs = 0;
    page.on("dialog", (dialog) => {
      dialogs += 1;
      void dialog.dismiss();
    });
    const evil = '<img src=x onerror="alert(1)">';
    await createTrip(page, evil);
    await addItem(page, 1, evil);
    await expect(page.locator(".item-title")).toHaveText([evil]);
    expect(await page.locator("main img").count()).toBe(0);
    expect(dialogs).toBe(0);
  });
});

test.describe("二重押し", () => {
  test("支出は 1 件だけ記録される", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await createTrip(page, "二重の支出");
    await openTab(page, "割り勘");
    const seen = await slowAndCount(page, /\/expenses$/);
    await page.getByLabel("内容").fill("昼");
    await page.getByLabel("金額(円)").fill("1000");
    await page.getByRole("button", { name: "記録する" }).dblclick();
    await page.waitForTimeout(1800);
    expect(seen.count).toBe(1);
  });

  test("コメントは 1 件だけ書かれる", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await createTrip(page, "二重のコメント");
    await addItem(page, 1, "予定");
    await page.locator("summary").click();
    const seen = await slowAndCount(page, /\/comments$/);
    await page.getByLabel(/^コメント/).fill("一度だけ");
    await page.getByRole("button", { name: "送る" }).dblclick();
    await page.waitForTimeout(1800);
    expect(seen.count).toBe(1);
  });

  test("候補の採用は 1 回だけ送られる", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await createTrip(page, "二重の採用");
    await openTab(page, "候補");
    await page.getByLabel("候補の名前").fill("平等院");
    await page.getByRole("button", { name: "候補に出す" }).click();
    await page.getByRole("button", { name: "旅程に入れる: 平等院" }).click();
    const seen = await slowAndCount(page, /\/adopt$/);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /入れる/ })
      .dblclick();
    await page.waitForTimeout(1800);
    expect(seen.count).toBe(1);
  });

  test("旅は 1 つだけ作られる", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await page.getByRole("link", { name: "旅を作る" }).click();
    const seen = await slowAndCount(page, /^\/trips$/);
    await page.getByLabel(/^タイトル/).fill("二重の旅");
    await page.locator("#tf-start").fill("2027/04/01");
    await page.locator("#tf-end").fill("2027/04/02");
    await page.getByRole("button", { name: "作る" }).dblclick();
    await page.waitForTimeout(1800);
    expect(seen.count).toBe(1);
  });
});

test.describe("状態とフォーカス", () => {
  test("旅の設定で別の操作をしても、保存前の入力が消えない", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await createTrip(page, "入力途中の旅");
    await page.getByRole("link", { name: "旅の設定" }).click();
    await page.getByLabel(/^タイトル/).fill("保存前の題名");
    await page.getByRole("button", { name: "公開リンクを発行する" }).click();
    await expect(page.getByLabel("公開リンク")).toBeVisible();
    await expect(page.getByLabel(/^タイトル/)).toHaveValue("保存前の題名");
  });

  test("削除した後、キーボードの位置が画面の先頭に飛ばない", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await createTrip(page, "フォーカスの旅");
    await addItem(page, 1, "A");
    await addItem(page, 1, "B");
    await page.getByRole("button", { name: "削除: A" }).click();
    await confirmIn(page, "削除する");
    await expect(page.locator(".item-title")).toHaveText(["B"]);
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.tagName), { timeout: 3000 })
      .not.toBe("BODY");
  });

  test("承認された後に招待リンクが変わっても、行き止まりにならない", async ({ browser }) => {
    const owner = await openAs(browser, "たろう");
    const guest = await openAs(browser, "はなこ");
    await createTrip(owner, "リンクが変わる旅");
    await guest.goto(await inviteUrl(owner));
    await guest.getByRole("button", { name: "参加を申請する" }).click();
    await expect(guest.getByText("参加を申請しました")).toBeVisible();
    await owner.getByRole("button", { name: "承認: はなこ" }).click();
    await owner.getByRole("button", { name: "リンクを発行し直す" }).click();
    await expect(guest.getByText("リンクが変わる旅").first()).toBeVisible({ timeout: 15_000 });
    await expect(guest).toHaveURL(/\/trips/, { timeout: 15_000 });
  });

  test("承認待ちで通信が一度切れても、戻れば誤りの表示が消える", async ({ browser }) => {
    const owner = await openAs(browser, "たろう");
    const guest = await openAs(browser, "はなこ");
    await createTrip(owner, "一時的に切れる旅");
    await guest.goto(await inviteUrl(owner));
    await guest.getByRole("button", { name: "参加を申請する" }).click();
    await expect(guest.getByText("参加を申請しました")).toBeVisible();
    let broken = true;
    await guest.route(
      (url) => url.origin === API && url.pathname.startsWith("/join/"),
      (route) => (broken ? route.abort() : route.continue()),
    );
    await expect(guest.getByText("サーバーにつながりません")).toBeVisible({ timeout: 10_000 });
    broken = false;
    await expect(guest.getByText("サーバーにつながりません")).toHaveCount(0, { timeout: 10_000 });
  });

  test("旅の一覧は、画面に戻ったときに新しくなる", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    const other = await sameUserTab(page, "/trips");
    await createTrip(other, "別のタブで作った旅");
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByText("別のタブで作った旅")).toBeVisible();
  });

  test("ログイン後の戻り先に、よそのサイトを指定しても移動しない", async ({ page }) => {
    await page.goto("/login?returnTo=//example.com/phishing");
    await page.getByLabel("利用者 ID").fill(`redirect-${Date.now()}`);
    await page.getByLabel("表示名").fill("たろう");
    await page.getByRole("button", { name: "ログイン" }).click();
    await expect(page).toHaveURL(/localhost:3001\/trips$/);
  });
});
