import { describe, expect, it } from "vitest";
import { parseDateInput, toDateText } from "./date";

describe("日付の入力(YYYY/MM/DD)", () => {
  it.each(["2027/04/01", "2027/4/1", "20270401", "2027-04-01", " ２０２７／０４／０１ "])(
    "「%s」を 2027-04-01 として読む",
    (text) => {
      expect(parseDateInput(text)).toBe("2027-04-01");
    },
  );

  it("うるう年の 2 月 29 日は読める", () => {
    expect(parseDateInput("2028/02/29")).toBe("2028-02-29");
  });

  it.each([
    "",
    "2027/02/29",
    "2027/04/31",
    "2027/13/01",
    "2027/04/00",
    "04/01/2027",
    "2027/04",
    "0000/01/01",
    "2027/04-01",
  ])("「%s」は日付として読まない", (text) => {
    expect(parseDateInput(text)).toBeNull();
  });

  it("画面には YYYY/MM/DD で出し、日付でない文字は打ったまま残す", () => {
    expect(toDateText("2027-04-01")).toBe("2027/04/01");
    expect(toDateText("2027/4")).toBe("2027/4");
    expect(toDateText("")).toBe("");
  });
});
