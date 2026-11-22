import { describe, expect, it } from "vitest";
import { validateTrip } from "./validate";

const trip = { title: "旅", startDate: "2027-04-01", endDate: "2027-04-03", destination: "" };

describe("旅の日付の確認", () => {
  it("正しい日付なら誤りなし", () => {
    expect(validateTrip(trip)).toEqual([]);
  });

  it("日付として読めない文字なら、どちらの欄かと正しい形を知らせる", () => {
    expect(validateTrip({ ...trip, startDate: "2027/02/30" })).toEqual([
      "開始日は正しい日付を YYYY/MM/DD の形で入力してください",
    ]);
    expect(validateTrip({ ...trip, endDate: "4/3" })).toEqual([
      "終了日は正しい日付を YYYY/MM/DD の形で入力してください",
    ]);
  });
});
