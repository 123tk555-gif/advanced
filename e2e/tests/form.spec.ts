import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures.js";
import { createTrip, openAs } from "./helpers.js";

/** 標準の日付欄はブラウザの言語で並びが変わるので、英語のブラウザで確かめる */
test.use({ locale: "en-US" });

async function expectSameTop(a: Locator, b: Locator) {
  const top = async (l: Locator) => (await l.boundingBox())?.y ?? Number.NaN;
  expect(Math.abs((await top(a)) - (await top(b)))).toBeLessThanOrEqual(1);
}

test("開始日・終了日は YYYY/MM/DD で表示する", async ({ browser }) => {
  const taro = await openAs(browser, "たろう");
  await taro.getByRole("link", { name: "旅を作る" }).click();
  const start = taro.locator("#tf-start");
  await expect(start).toHaveAttribute("placeholder", "YYYY/MM/DD");

  // 手入力は、欄を離れると形がそろう
  await start.fill("20270401");
  await start.blur();
  await expect(start).toHaveValue("2027/04/01");

  // カレンダーから選んでも同じ形
  await taro.locator("#tf-end-picker").fill("2027-04-03");
  await expect(taro.locator("#tf-end")).toHaveValue("2027/04/03");

  await taro.getByLabel("タイトル").fill("日付の旅");
  await taro.getByRole("button", { name: "作る" }).click();
  await taro.getByRole("link", { name: "旅の設定" }).click();
  await expect(taro.locator("#tf-start")).toHaveValue("2027/04/01");
  await expect(taro.locator("#tf-end")).toHaveValue("2027/04/03");
});

test("日付として読めない入力では保存しない", async ({ browser }) => {
  const taro = await openAs(browser, "たろう");
  await taro.getByRole("link", { name: "旅を作る" }).click();
  await taro.getByLabel("タイトル").fill("日付が違う旅");
  await taro.locator("#tf-start").fill("2027/02/30");
  await taro.locator("#tf-end").fill("2027/03/02");
  await taro.getByRole("button", { name: "作る" }).click();
  await expect(taro.getByText("開始日は正しい日付を YYYY/MM/DD の形で")).toBeVisible();
  await expect(taro).toHaveURL(/\/trips\/new$/);
});

for (const width of [1280, 561]) {
  test(`横に並ぶ入力欄は上端がそろう(幅 ${width}px)`, async ({ browser }) => {
    const taro = await openAs(browser, "たろう");
    await taro.setViewportSize({ width, height: 900 });
    await taro.getByRole("link", { name: "旅を作る" }).click();
    await expectSameTop(taro.locator("#tf-start"), taro.locator("#tf-end"));
    await taro.goto("/trips");

    await createTrip(taro, "段の旅");
    await taro.getByRole("button", { name: /予定を追加.*1日目/ }).click();
    await expectSameTop(taro.locator("#it-day"), taro.locator("#it-time"));
    await taro.getByRole("dialog").getByRole("button", { name: "やめる" }).click();

    await taro.getByRole("link", { name: "割り勘" }).click();
    const fields = taro.locator(".field-row > div > :is(input, select)");
    await expect(fields).toHaveCount(2);
    await expectSameTop(fields.first(), fields.last());
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`YYYY/MM/DD の薄い文字も読める(${colorScheme}、コントラスト比 4.5 以上)`, async ({
    browser,
  }) => {
    const taro = await openAs(browser, "たろう");
    await taro.emulateMedia({ colorScheme });
    await taro.getByRole("link", { name: "旅を作る" }).click();
    const ratio = await taro.locator("#tf-start").evaluate((el) => {
      const luminance = (color: string) => {
        const [r = 0, g = 0, b = 0] = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((value) => {
          const c = Number(value) / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const text = luminance(getComputedStyle(el, "::placeholder").color);
      const back = luminance(getComputedStyle(el).backgroundColor);
      return (Math.max(text, back) + 0.05) / (Math.min(text, back) + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
}
