import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./return-to";

describe("ログイン後の戻り先", () => {
  it("このサイトの中の場所なら、そのまま使う", () => {
    expect(safeReturnTo("/trips/abc?tab=ideas")).toBe("/trips/abc?tab=ideas");
    expect(safeReturnTo("/join/token")).toBe("/join/token");
  });

  it("よそのサイトになる書き方・空・文字列でないものは、旅の一覧にする", () => {
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "trips", ""]) {
      expect(safeReturnTo(bad)).toBe("/trips");
    }
    expect(safeReturnTo(undefined)).toBe("/trips");
    expect(safeReturnTo(["/trips/a"])).toBe("/trips");
  });

  it("ログイン・登録の画面へは戻さない(行ったり来たりしないように)", () => {
    for (const page of ["/login", "/signup", "/signup/confirm?email=a", "/password-reset"]) {
      expect(safeReturnTo(page)).toBe("/trips");
    }
  });
});
