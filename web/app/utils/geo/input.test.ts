import { describe, expect, it } from "vitest";
import { labelFromInput, placeError } from "./input";

describe("場所の入力", () => {
  it("保存する表示名は、利用者が入力した文字(前後の空白は除き、200 文字まで)", () => {
    expect(labelFromInput("  お稲荷さん ")).toBe("お稲荷さん");
    expect(labelFromInput("あ".repeat(250))).toHaveLength(200);
  });

  it("候補から選んでいない文字は保存させない", () => {
    expect(placeError(null, "京都")).toMatch("候補から選んで");
    expect(placeError(null, " ")).toBeNull();
  });

  it("選んだ場所の表示名は空にできない", () => {
    expect(placeError({ label: " ", placeId: "p" }, "")).toMatch("表示名");
    expect(placeError({ label: "駅", placeId: "p" }, "")).toBeNull();
  });
});
