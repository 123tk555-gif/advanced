import { expect, test } from "@playwright/test";
import { createTrip, openAs } from "./helpers.js";

test("駅・バス停が種類つきで候補に出て、選べる", async ({ browser }) => {
  const taro = await openAs(browser, "たろう");
  await createTrip(taro, "停車地の旅");
  await taro.getByRole("button", { name: /予定を追加.*1日目/ }).click();
  const dialog = taro.getByRole("dialog");
  await dialog.getByLabel("タイトル").fill("バスを降りる");
  await dialog.getByRole("combobox", { name: /場所/ }).fill("清水");
  const list = dialog.getByRole("listbox", { name: "場所の候補" });
  await list.getByRole("option", { name: /清水道.*バス停/ }).click();
  await dialog.getByRole("button", { name: "保存する" }).click();
  await expect(taro.locator(".item-title")).toHaveText(["バスを降りる"]);
});

test("候補が増えても、↓ で選んだ候補が見える位置に来る", async ({ browser }) => {
  const taro = await openAs(browser, "たろう");
  await taro.setViewportSize({ width: 375, height: 560 });
  await createTrip(taro, "候補の多い旅");
  await taro.getByRole("button", { name: /予定を追加.*1日目/ }).click();
  const dialog = taro.getByRole("dialog");
  const box = dialog.getByRole("combobox", { name: /場所/ });
  await box.fill("京都");
  const options = dialog.getByRole("listbox", { name: "場所の候補" }).getByRole("option");
  await expect.poll(() => options.count()).toBeGreaterThanOrEqual(8);
  const count = await options.count();
  for (let i = 0; i < count; i++) await box.press("ArrowDown");

  const last = options.last();
  await expect(last).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(() =>
      last.evaluate((li) => {
        const row = li.getBoundingClientRect();
        const list = (li.parentElement as HTMLElement).getBoundingClientRect();
        return row.bottom <= list.bottom + 1 && row.top >= list.top - 1;
      }),
    )
    .toBe(true);
});

test("候補を選んですぐ保存しても、場所つきで保存される(予定・候補)", async ({ browser }) => {
  const taro = await openAs(browser, "たろう");
  await createTrip(taro, "急ぐ旅");
  await taro.getByRole("button", { name: /予定を追加.*1日目/ }).click();
  const dialog = taro.getByRole("dialog");
  await dialog.getByLabel("タイトル").fill("すぐ保存");
  await dialog.getByRole("combobox", { name: /場所/ }).fill("清水寺");
  await dialog.getByRole("option", { name: "清水寺" }).click();
  await dialog.getByRole("button", { name: "保存する" }).click();
  await expect(taro.locator(".item-place")).toHaveText("場所: 清水寺");

  await taro.getByRole("link", { name: "候補", exact: true }).click();
  await taro.getByLabel("候補の名前").fill("金閣寺に行きたい");
  await taro.getByRole("combobox", { name: /場所/ }).fill("金閣寺");
  await taro.getByRole("listbox", { name: "場所の候補" }).getByRole("option").first().click();
  const saved = taro.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/ideas"));
  await taro.getByRole("button", { name: "候補に出す" }).click();
  expect((await saved).postDataJSON().place?.placeId).toBe("fake:金閣寺(鹿苑寺)");
});

test("選んだ場所の名前は画面にだけ出て、表示名をそのまま打ち直せる", async ({ browser }) => {
  const taro = await openAs(browser, "たろう");
  await createTrip(taro, "名前の旅");
  await taro.getByRole("button", { name: /予定を追加.*1日目/ }).click();
  const dialog = taro.getByRole("dialog");
  await dialog.getByLabel("タイトル").fill("降りる");
  await dialog.getByRole("combobox", { name: /場所/ }).fill("河原町");
  await dialog.getByRole("option", { name: /京都河原町駅/ }).click();

  await expect(dialog.getByText("選んだ場所: 京都河原町駅")).toBeVisible();
  const label = dialog.getByRole("textbox", { name: /場所/ });
  await expect(label).toHaveValue("河原町");
  await expect(label).toHaveAccessibleDescription(/選んだ場所: 京都河原町駅/);
  // 全選択になっているので、そのまま打てば置き換わる
  await expect(label).toBeFocused();
  await taro.keyboard.type("阪急の駅");
  await expect(label).toHaveValue("阪急の駅");

  const saved = taro.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/items"));
  await dialog.getByRole("button", { name: "保存する" }).click();
  // 選んだ場所の名前は送らない
  expect((await saved).postDataJSON().place).toEqual({
    label: "阪急の駅",
    placeId: "fake:京都河原町駅",
  });

  await taro.getByRole("button", { name: "編集: 降りる" }).click();
  await expect(label).toHaveValue("阪急の駅");
  await expect(dialog.getByText(/選んだ場所:/)).toHaveCount(0);
});
