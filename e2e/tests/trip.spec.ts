import { expect, test } from "@playwright/test";
import { addItem, createTrip, inviteUrl, joinAndApprove, openAs, uniqueId } from "./helpers.js";

test("旅を作り、場所つきの予定を足すと、一覧と地図に出る", async ({ browser }) => {
  const taro = await openAs(browser, "たろう");
  await createTrip(taro, "京都 2泊3日");

  await addItem(taro, 1, "京都駅に集合", "京都駅");
  await addItem(taro, 1, "伏見稲荷大社", "伏見稲荷");

  // 地図に 2 つのピンと、区間の移動時間が出る
  await expect(taro.getByRole("img", { name: /1日目の地図.*京都駅.*伏見稲荷大社/ })).toBeVisible();
  await expect(taro.locator(".map-legs li")).toHaveCount(1);

  // 再読み込みしても残っている(サーバーに保存されている)
  await taro.reload();
  await expect(taro.locator(".item-title")).toHaveText(["京都駅に集合", "伏見稲荷大社"]);
});

test("予定を ↓ で並べ替えると、順番が保存される", async ({ browser }) => {
  const taro = await openAs(browser, "たろう");
  await createTrip(taro, "並べ替えの旅");
  await addItem(taro, 1, "A");
  await addItem(taro, 1, "B");

  await taro.getByRole("button", { name: "「A」を下へ" }).click();
  await expect(taro.locator(".item-title")).toHaveText(["B", "A"]);
  await taro.reload();
  await expect(taro.locator(".item-title")).toHaveText(["B", "A"]);
});

test("招待リンクから申請し、オーナーが承認するとしおりが見える", async ({ browser }) => {
  const taro = await openAs(browser, "たろう");
  await createTrip(taro, "招待の旅");
  const url = await inviteUrl(taro);

  const hanako = await openAs(browser, "はなこ");
  await hanako.goto(url);
  await expect(hanako.getByRole("heading", { name: "旅への招待" })).toBeVisible();
  await expect(hanako.getByText("招待の旅")).toBeVisible();
  await hanako.getByRole("button", { name: "参加を申請する" }).click();
  await expect(hanako.getByText("参加を申請しました")).toBeVisible();

  // 承認されるまでは、旅の一覧の「承認待ち」にだけ出る
  await hanako.goto("/trips");
  await expect(hanako.getByText("招待の旅")).toBeVisible();
  await expect(hanako.getByText("オーナーの承認待ち")).toBeVisible();

  await taro.reload();
  await taro.getByRole("button", { name: "承認: はなこ" }).click();

  // メンバーになった後に招待リンクを開くと、そのまま旅の画面へ
  await hanako.goto(url);
  await expect(hanako.getByRole("heading", { level: 1, name: "招待の旅" })).toBeVisible();
});

test("ログインしていない人が招待リンクを開き、承認を待っていると、承認後に旅の画面へ移る", async ({
  browser,
}) => {
  const taro = await openAs(browser, "たろう");
  await createTrip(taro, "待っている旅");
  const url = await inviteUrl(taro);

  // ログインしていない状態でリンクを開く → ログイン → 招待の画面に戻る
  const hanako = await (await browser.newContext()).newPage();
  await hanako.goto(url);
  await hanako.getByLabel("利用者 ID").fill(uniqueId("u"));
  await hanako.getByLabel("表示名").fill("はなこ");
  await hanako.getByRole("button", { name: "ログイン" }).click();
  await expect(hanako.getByRole("heading", { name: "旅への招待" })).toBeVisible();
  await hanako.getByRole("button", { name: "参加を申請する" }).click();
  await expect(hanako.getByText("参加を申請しました")).toBeVisible();

  // はなこは画面を開いたまま待つ。オーナーが承認すると、自動で旅の画面に切り替わる
  await taro.reload();
  await taro.getByRole("button", { name: "承認: はなこ" }).click();
  await expect(hanako.getByRole("heading", { level: 1, name: "待っている旅" })).toBeVisible({
    timeout: 15_000,
  });
});

test("2 人が同じ予定を同時に編集すると、後から保存した人に衝突の画面が出る", async ({
  browser,
}) => {
  const taro = await openAs(browser, "たろう");
  await createTrip(taro, "同時編集の旅");
  await addItem(taro, 1, "清水寺");
  const hanako = await openAs(browser, "はなこ");
  await joinAndApprove(taro, hanako, "はなこ");
  const tripUrl = taro.url().split("?")[0] as string;

  await taro.goto(tripUrl);
  await hanako.goto(tripUrl);
  await taro.getByRole("button", { name: "編集: 清水寺" }).click();
  await hanako.getByRole("button", { name: "編集: 清水寺" }).click();

  // はなこが先に保存
  await hanako.getByRole("dialog").getByLabel("メモ").fill("夜の特別拝観");
  await hanako.getByRole("dialog").getByRole("button", { name: "保存する" }).click();
  await expect(hanako.getByRole("dialog")).toBeHidden();

  // たろうが後から保存 → 衝突の画面
  await taro.getByRole("dialog").getByLabel("タイトル").fill("清水寺(朝)");
  await taro.getByRole("dialog").getByRole("button", { name: "保存する" }).click();
  const conflict = taro.getByRole("dialog");
  await expect(
    conflict.getByRole("heading", { name: "ほかの人が先に変更していました" }),
  ).toBeVisible();
  await expect(conflict.getByText("夜の特別拝観")).toBeVisible();

  await conflict.getByRole("button", { name: "あなたの内容で保存する" }).click();
  await expect(taro.locator(".item-title")).toHaveText(["清水寺(朝)"]);
});

test("候補に投票して旅程に入れ、割り勘を記録すると精算が出る", async ({ browser }) => {
  const taro = await openAs(browser, "たろう");
  await createTrip(taro, "候補と割り勘の旅");
  const hanako = await openAs(browser, "はなこ");
  await joinAndApprove(taro, hanako, "はなこ");

  // 候補
  await taro.getByRole("link", { name: "候補" }).click();
  await taro.getByLabel("候補の名前").fill("平等院");
  await taro.getByRole("button", { name: "候補に出す" }).click();
  await taro.getByRole("button", { name: "行きたい!: 平等院" }).click();
  await expect(taro.getByText("1 票")).toBeVisible();
  await taro.getByRole("button", { name: "旅程に入れる: 平等院" }).click();
  await taro.getByRole("dialog").getByLabel("どの日に入れますか").selectOption("2");
  await taro.getByRole("dialog").getByRole("button", { name: "旅程に入れる" }).click();
  await expect(taro.getByText("旅程に入れました(2日目)")).toBeVisible();

  // 割り勘: たろうが 3000 円を 2 人分払った → はなこ → たろう 1500 円
  await taro.getByRole("link", { name: "割り勘" }).click();
  await taro.getByLabel("内容").fill("新幹線");
  await taro.getByLabel("金額(円)").fill("3000");
  await taro.getByRole("button", { name: "記録する" }).click();
  await expect(taro.getByRole("listitem").filter({ hasText: "はなこ → たろう" })).toContainText(
    "1,500 円",
  );
});

test("公開しおりは、ログインしていない人でも見られる。割り勘は出ない", async ({ browser }) => {
  const taro = await openAs(browser, "たろう");
  await createTrip(taro, "公開の旅");
  await addItem(taro, 1, "金閣寺", "金閣寺");
  await taro.getByRole("link", { name: "旅の設定" }).click();
  await taro.getByRole("button", { name: "公開リンクを発行する" }).click();
  const url = await taro.getByLabel("公開リンク").inputValue();

  const anonymous = await (await browser.newContext()).newPage();
  await anonymous.goto(url);
  await expect(anonymous.getByRole("heading", { level: 1, name: "公開の旅" })).toBeVisible();
  await expect(anonymous.locator(".item-title")).toHaveText(["金閣寺"]);
  await expect(anonymous.getByText("精算")).toHaveCount(0);
});

test("メンバーでない人が旅の URL を開いても、「見つかりません」になる", async ({ browser }) => {
  const taro = await openAs(browser, "たろう");
  await createTrip(taro, "ないしょの旅");
  const tripUrl = taro.url();

  const stranger = await openAs(browser, "よその人");
  await stranger.goto(tripUrl);
  await expect(stranger.getByRole("heading", { name: "ページが見つかりません" })).toBeVisible();
  await expect(stranger.getByText("ないしょの旅")).toHaveCount(0);
});

test("ログインしていない人が旅の一覧を開くと、ログイン画面になる", async ({ page }) => {
  await page.goto("/trips");
  await expect(page.getByRole("heading", { level: 1, name: /ログイン/ })).toBeVisible();
});
