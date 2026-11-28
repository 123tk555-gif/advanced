import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import {
  addItem,
  confirmIn,
  createTrip,
  expenseOf,
  inviteUrl,
  joinAndApprove,
  openAs,
  openTab,
  proposeIdea,
  reloadAndWait,
  showList,
  showMap,
  stubClipboard,
} from "./helpers.js";

/** 画面上の操作の網羅(ほかの spec に無いもの)。保存は再読み込みしても残ることまで確かめる */

async function ownerAndMember(open: () => Promise<[Page, Page]>) {
  const [owner, member] = await open();
  await createTrip(owner, "操作の旅");
  const url = owner.url();
  await joinAndApprove(owner, member, "はなこ");
  await owner.goto(url);
  await member.goto(url);
  await expect(member.getByRole("heading", { level: 1, name: "操作の旅" })).toBeVisible();
  return { owner, member, url };
}

test.describe("旅程", () => {
  test("予定のすべての欄を編集して保存できる", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await createTrip(page, "編集の旅");
    await addItem(page, 1, "朝");
    await page.getByRole("button", { name: "編集: 朝" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("日にち").selectOption("2");
    await dialog.getByLabel(/^時刻/).fill("09:30");
    await dialog.getByLabel(/^タイトル/).fill("朝ごはん");
    await dialog.getByLabel(/^メモ/).fill("2 行の\nメモ");
    await dialog.getByRole("button", { name: "保存する" }).click();
    await expect(dialog).toBeHidden();
    await reloadAndWait(page, "編集の旅");
    const item = page.locator(".day").nth(1).locator(".item");
    await expect(item).toContainText("09:30");
    await expect(item).toContainText("朝ごはん");
    await item.locator("summary").click();
    await expect(item.locator("p.memo")).toContainText("メモ");
  });

  test("予定の削除は、やめれば残り、確定すれば消える", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await createTrip(page, "削除の旅");
    await addItem(page, 1, "消す予定");
    await page.getByRole("button", { name: "削除: 消す予定" }).click();
    await confirmIn(page, "やめる");
    await expect(page.locator(".item-title")).toHaveCount(1);
    await page.getByRole("button", { name: "削除: 消す予定" }).click();
    await confirmIn(page, "削除する");
    await expect(page.locator(".item-title")).toHaveCount(0);
    await reloadAndWait(page, "削除の旅");
    await expect(page.locator(".item-title")).toHaveCount(0);
  });

  test("予定を別の日へ上下で動かせる", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await createTrip(page, "日またぎの旅");
    await addItem(page, 1, "移す");
    await page.getByRole("button", { name: "「移す」を下へ" }).click();
    await expect(page.locator(".day").nth(1).locator(".item-title")).toHaveText(["移す"]);
    await reloadAndWait(page, "日またぎの旅");
    await expect(page.locator(".day").nth(1).locator(".item-title")).toHaveText(["移す"]);
  });

  test("自分のコメントだけを消せる", async ({ browser }) => {
    const { owner, member } = await ownerAndMember(async () => [
      await openAs(browser, "たろう"),
      await openAs(browser, "はなこ"),
    ]);
    await addItem(owner, 1, "コメントの予定");
    await owner.locator("summary").click();
    await owner.getByLabel(/^コメント/).fill("消すコメント");
    await owner.getByRole("button", { name: "送る" }).click();
    await expect(member.locator("summary")).toContainText("(1)");
    await member.locator("summary").click();
    await expect(member.getByText("消すコメント")).toBeVisible();
    await expect(member.getByRole("button", { name: "削除: 自分のコメント" })).toHaveCount(0);
    await owner.getByRole("button", { name: "削除: 自分のコメント" }).click();
    await expect(owner.locator("summary")).toContainText("(0)");
    await expect(member.locator("summary")).toContainText("(0)");
  });

  for (const choice of ["keep", "reedit"] as const) {
    test(`衝突したとき: ${choice === "keep" ? "今の内容のままにする" : "今の内容をもとに編集し直す"}`, async ({
      browser,
    }) => {
      const { owner, member } = await ownerAndMember(async () => [
        await openAs(browser, "たろう"),
        await openAs(browser, "はなこ"),
      ]);
      await addItem(owner, 1, "元");
      await expect(member.locator(".item-title")).toHaveText(["元"]);
      await owner.getByRole("button", { name: "編集: 元" }).click();
      await member.getByRole("button", { name: "編集: 元" }).click();
      await member
        .getByRole("dialog")
        .getByLabel(/^タイトル/)
        .fill("相手の内容");
      await member.getByRole("dialog").getByRole("button", { name: "保存する" }).click();
      await expect(member.getByRole("dialog")).toBeHidden();

      const dialog = owner.getByRole("dialog");
      await dialog.getByLabel(/^タイトル/).fill("自分の内容");
      await dialog.getByRole("button", { name: "保存する" }).click();
      if (choice === "keep") {
        await dialog.getByRole("button", { name: "今の内容のままにする" }).click();
        await expect(owner.locator(".item-title")).toHaveText(["相手の内容"]);
      } else {
        await dialog.getByRole("button", { name: "今の内容をもとに編集し直す" }).click();
        await expect(dialog.getByLabel(/^タイトル/)).toHaveValue("相手の内容");
        await dialog.getByLabel(/^タイトル/).fill("合わせた内容");
        await dialog.getByRole("button", { name: "保存する" }).click();
        await expect(owner.locator(".item-title")).toHaveText(["合わせた内容"]);
      }
    });
  }

  test("場所を外して保存できる", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await createTrip(page, "場所を外す旅");
    await addItem(page, 1, "寄り道", "清水寺");
    await page.getByRole("button", { name: "編集: 寄り道" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "場所を外す・選び直す" }).click();
    await expect(dialog.getByRole("combobox", { name: /場所/ })).toBeFocused();
    await dialog.getByRole("button", { name: "保存する" }).click();
    await expect(page.locator(".item-place")).toHaveCount(0);
  });

  test("地図の日・移動手段・一覧との切り替え", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await createTrip(page, "地図の旅");
    await addItem(page, 1, "駅", "京都駅");
    await addItem(page, 1, "寺", "清水寺");
    await showMap(page);
    const map = page.locator(".map-panel");
    await map.getByRole("button", { name: "車", exact: true }).click();
    await expect(map.locator(".map-legs li")).toContainText("車で約");
    await map.getByRole("button", { name: "徒歩", exact: true }).click();
    await expect(map.locator(".map-legs li")).toContainText("徒歩で約");
    await map.getByRole("button", { name: "2日目" }).click();
    await expect(map.locator(".map-legs li")).toHaveCount(0);
    await expect(map.getByRole("img", { name: /2日目の地図/ })).toBeVisible();
    await showList(page);
    await expect(page.locator(".item-title").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Google マップで開く/ }).first()).toHaveAttribute(
      "href",
      /query_place_id=/,
    );
  });
});

test.describe("候補・割り勘", () => {
  test("投票を取り消せる", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await createTrip(page, "投票の旅");
    await proposeIdea(page, "平等院");
    await page.getByRole("button", { name: "行きたい!: 平等院" }).click();
    await expect(page.locator(".votes")).toHaveText("1 票");
    await page.getByRole("button", { name: "投票済み(取り消す): 平等院" }).click();
    await expect(page.locator(".votes")).toHaveText("0 票");
  });

  test("候補の削除(やめる・確定)", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await createTrip(page, "候補を消す旅");
    await proposeIdea(page, "消す候補");
    await page.getByRole("button", { name: "消す: 消す候補" }).click();
    await confirmIn(page, "やめる");
    await expect(page.locator(".votes")).toHaveCount(1);
    await page.getByRole("button", { name: "消す: 消す候補" }).click();
    await confirmIn(page, "消す");
    await expect(page.locator(".votes")).toHaveCount(0);
  });

  test("採用は途中でやめられる", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await createTrip(page, "採用をやめる旅");
    await proposeIdea(page, "迷う候補");
    // Safari はクリックではボタンにフォーカスを移さないので、キーボードで開く
    const open = page.getByRole("button", { name: "旅程に入れる: 迷う候補" });
    await open.focus();
    await open.press("Enter");
    await page.getByRole("dialog").getByRole("button", { name: "やめる" }).click();
    await expect(page.getByRole("button", { name: "旅程に入れる: 迷う候補" })).toBeFocused();
  });

  test("支出を消すと、合計と精算も直る", async ({ browser }) => {
    const { owner } = await ownerAndMember(async () => [
      await openAs(browser, "たろう"),
      await openAs(browser, "はなこ"),
    ]);
    await openTab(owner, "割り勘");
    await expenseOf(owner, "夕食", 3000);
    await expect(owner.getByText("支出(合計 3,000 円)")).toBeVisible();
    await owner.getByRole("button", { name: "削除: 夕食" }).click();
    await confirmIn(owner, "削除する");
    await expect(owner.getByText("支出(合計 0 円)")).toBeVisible();
    await expect(owner.getByText("精算は必要ありません。")).toBeVisible();
  });

  test("払った人と分け合う人を選べる", async ({ browser }) => {
    const { owner } = await ownerAndMember(async () => [
      await openAs(browser, "たろう"),
      await openAs(browser, "はなこ"),
    ]);
    await openTab(owner, "割り勘");
    await owner.getByLabel("払った人").selectOption({ label: "はなこ" });
    await owner.getByRole("checkbox", { name: "はなこ" }).uncheck();
    await expenseOf(owner, "立て替え", 1200);
    await expect(owner.locator(".list-plain .money")).toHaveText("1,200 円");
  });
});

test.describe("メンバー・招待", () => {
  test("招待リンクのコピー・発行し直し・停止", async ({ browser }) => {
    const owner = await openAs(browser, "たろう");
    const guest = await openAs(browser, "じろう");
    await createTrip(owner, "招待操作の旅");
    const first = await inviteUrl(owner);
    const copied = await stubClipboard(owner);
    await owner.getByRole("button", { name: "コピー" }).click();
    await expect.poll(copied).toBe(first);

    await owner.getByRole("button", { name: "リンクを発行し直す" }).click();
    await expect(owner.getByLabel("招待リンク")).not.toHaveValue(first);
    await guest.goto(first);
    await expect(guest.getByRole("heading", { name: "ページが見つかりません" })).toBeVisible();

    const second = await owner.getByLabel("招待リンク").inputValue();
    await owner.getByRole("button", { name: "リンクを止める" }).click();
    await confirmIn(owner, "止める");
    await expect(owner.getByText("招待リンクは止められています。")).toBeVisible();
    await guest.goto(second);
    await expect(guest.getByRole("heading", { name: "ページが見つかりません" })).toBeVisible();
    await owner.getByRole("button", { name: "リンクを発行する" }).click();
    await expect(owner.getByLabel("招待リンク")).toBeVisible();
  });

  test("承認待ちが一覧に出て、却下されると消える", async ({ browser }) => {
    const owner = await openAs(browser, "たろう");
    const guest = await openAs(browser, "じろう");
    await createTrip(owner, "却下の旅");
    await guest.goto(await inviteUrl(owner));
    await guest.getByRole("button", { name: "参加を申請する" }).click();
    await expect(guest.getByText("参加を申請しました")).toBeVisible();
    await guest.getByRole("link", { name: "旅の一覧" }).click();
    await expect(guest.getByRole("listitem").filter({ hasText: "却下の旅" })).toContainText(
      "承認待ち",
    );
    await owner.getByRole("button", { name: "却下: じろう" }).click();
    await confirmIn(owner, "却下する");
    await expect(owner.getByText("未処理の申請はありません。")).toBeVisible();
    await guest.reload();
    await expect(guest.getByText("却下の旅")).toHaveCount(0);
  });

  test("メンバーには、オーナー専用の操作が出ない", async ({ browser }) => {
    const { member } = await ownerAndMember(async () => [
      await openAs(browser, "たろう"),
      await openAs(browser, "はなこ"),
    ]);
    await openTab(member, "メンバー");
    await expect(member.getByRole("button", { name: /発行|止める|承認|却下/ })).toHaveCount(0);
    await member.getByRole("link", { name: "旅の設定" }).click();
    await expect(member.getByLabel(/^タイトル/)).toBeDisabled();
    await expect(member.locator("#tf-start")).toBeDisabled();
    await expect(member.getByRole("button", { name: "この旅を削除する" })).toHaveCount(0);
  });
});

test.describe("旅の設定", () => {
  test("旅の画面から、旅の設定へのボタンが見つけやすい。できることは役割に合わせて書く", async ({
    browser,
  }) => {
    const owner = await openAs(browser, "たろう");
    const guest = await openAs(browser, "はなこ");
    await createTrip(owner, "設定を探す旅");
    const ownerLink = owner.getByRole("link", { name: /^旅の設定/ });
    await expect(ownerLink).toHaveAccessibleName(/タイトル・日程の変更.*旅の削除/);
    await expect(ownerLink).toHaveClass(/\bbutton\b/);
    // 押しやすい大きさ(ほかのボタンと同じ 44px 以上)
    expect((await ownerLink.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    await openTab(owner, "メンバー");
    await joinAndApprove(owner, guest, "はなこ");
    await guest.reload();
    const guestLink = guest.getByRole("link", { name: /^旅の設定/ });
    await expect(guestLink).toBeVisible();
    // オーナーでなければ削除はできないので、書かない
    await expect(guestLink).not.toHaveAccessibleName(/削除/);
    await expect(guestLink).toHaveAccessibleName(/抜ける/);
  });

  test("旅の情報を変えると、一覧にも出る", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await createTrip(page, "変更前の旅");
    await page.getByRole("link", { name: "旅の設定" }).click();
    await page.getByLabel(/^タイトル/).fill("変更後の旅");
    await page.locator("#tf-end").fill("2027/04/05");
    await page.getByLabel(/^行き先/).fill("奈良");
    await page.getByRole("button", { name: "保存する" }).click();
    await expect(page.getByText("旅の情報を保存しました")).toBeVisible();
    await page.getByRole("link", { name: "旅の一覧" }).click();
    const card = page.locator(".trip-card", { hasText: "変更後の旅" });
    await expect(card).toContainText("5日間");
    await expect(card).toContainText("奈良");
  });

  test("予定のある日より短くできない", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await createTrip(page, "短くする旅");
    await addItem(page, 3, "最終日");
    await page.getByRole("link", { name: "旅の設定" }).click();
    await page.locator("#tf-end").fill("2027/04/01");
    await page.getByRole("button", { name: "保存する" }).click();
    await expect(page.getByText(/予定がある日より短くはできません/)).toBeVisible();
  });

  test("公開リンクのコピー・表示・停止", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await createTrip(page, "公開操作の旅");
    await page.getByRole("link", { name: "旅の設定" }).click();
    await page.getByRole("button", { name: "公開リンクを発行する" }).click();
    const url = await page.getByLabel("公開リンク").inputValue();
    const copied = await stubClipboard(page);
    await page.getByRole("button", { name: "コピー" }).click();
    await expect.poll(copied).toBe(url);

    await page.getByRole("link", { name: "公開しおりを見る" }).click();
    await expect(page.getByText("これは公開しおりです")).toBeVisible();
    await showMap(page);
    await expect(page.getByRole("img", { name: /1日目の地図/ })).toBeVisible();
    await showList(page);
    await expect(page.locator(".day").first()).toBeVisible();

    await page.goBack();
    await page.getByRole("button", { name: "公開を止める" }).click();
    await confirmIn(page, "止める");
    await expect(page.getByText("公開していません。")).toBeVisible();
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "ページが見つかりません" })).toBeVisible();
  });

  test("オーナーの引き継ぎの後、抜けられる", async ({ browser }) => {
    const { owner, member } = await ownerAndMember(async () => [
      await openAs(browser, "たろう"),
      await openAs(browser, "はなこ"),
    ]);
    await owner.getByRole("link", { name: "旅の設定" }).click();
    await owner.getByLabel("オーナーを引き継ぐ").selectOption({ label: "はなこ" });
    await owner.getByRole("button", { name: "引き継ぐ", exact: true }).click();
    await confirmIn(owner, "引き継ぐ");
    await owner.getByRole("button", { name: "この旅から抜ける" }).click();
    await confirmIn(owner, "抜ける");
    await expect(owner).toHaveURL(/\/trips$/);
    await expect(owner.locator(".trip-card")).toHaveCount(0);
    await openTab(member, "メンバー");
    await expect(member.getByText("メンバー(1 人)")).toBeVisible();
    await expect(member.locator(".badge.owner")).toBeVisible();
  });

  test("旅の削除(やめる・確定)", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await createTrip(page, "削除する旅");
    const url = page.url();
    await page.getByRole("link", { name: "旅の設定" }).click();
    await page.getByRole("button", { name: "この旅を削除する" }).click();
    await confirmIn(page, "やめる");
    await page.getByRole("button", { name: "この旅を削除する" }).click();
    await confirmIn(page, "削除する");
    await expect(page).toHaveURL(/\/trips$/);
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "ページが見つかりません" })).toBeVisible();
  });
});

test.describe("入口・アカウント", () => {
  test("旅の作成を途中でやめられる", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await page.getByRole("link", { name: "旅を作る" }).click();
    await page.getByRole("link", { name: "やめる" }).click();
    await expect(page.getByText("まだ旅がありません。")).toBeVisible();
  });

  test("トップと無い URL", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await page.goto("/");
    await expect(page).toHaveURL(/\/trips$/);
    await page.goto("/no-such-page");
    await page.getByRole("link", { name: "トップへ戻る" }).click();
    await expect(page).toHaveURL(/\/trips$/);
  });

  test("画面の色を選ぶと、開き直しても残る", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await page.goto("/settings");
    await page.getByRole("radio", { name: "ダーク" }).check();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("radio", { name: "ライト" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("radio", { name: "端末に合わせる" }).check();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme");
  });

  test("ログアウトして別の人で入ると、前の人の旅は見えない", async ({ browser }) => {
    const page = await openAs(browser, "たろう");
    await createTrip(page, "前の人の旅");
    await page.getByRole("link", { name: "旅の一覧" }).click();
    await expect(page.getByText("前の人の旅")).toBeVisible();
    await page.getByRole("link", { name: "たろう さん" }).click();
    await page.getByRole("button", { name: "ログアウト" }).click();
    await page.getByLabel("利用者 ID").fill(`other-${Date.now()}`);
    await page.getByLabel("表示名").fill("別の人");
    await page.getByRole("button", { name: "ログイン" }).click();
    await expect(page.getByText("まだ旅がありません。")).toBeVisible();
    await expect(page.getByText("前の人の旅")).toHaveCount(0);
  });

  test("退会すると、ほかの人に「退会した会員」と出る", async ({ browser }) => {
    const { owner, member } = await ownerAndMember(async () => [
      await openAs(browser, "たろう"),
      await openAs(browser, "はなこ"),
    ]);
    await openTab(owner, "メンバー");
    await member.getByRole("link", { name: "はなこ さん" }).click();
    await member.getByRole("button", { name: "退会する" }).click();
    await confirmIn(member, "退会する");
    await expect(member).toHaveURL(/\/login/);
    await expect(owner.getByText("退会した会員").first()).toBeVisible();
  });
});
