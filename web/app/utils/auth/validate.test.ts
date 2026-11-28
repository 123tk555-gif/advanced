import { describe, expect, it } from "vitest";
import {
  MIN_PASSWORD,
  validateCode,
  validateDisplayName,
  validateEmail,
  validatePassword,
} from "./validate";

describe("メールアドレス", () => {
  it("ふつうの形なら誤りなし", () => {
    expect(validateEmail("taro@example.com")).toEqual([]);
    expect(validateEmail("  taro@example.com  ")).toEqual([]);
  });
  it("空・@ が無い・長すぎるなら知らせる", () => {
    expect(validateEmail("")).toEqual(["メールアドレスを入力してください"]);
    expect(validateEmail("taro.example.com")).toEqual([
      "メールアドレスの形を確かめてください(例: taro@example.com)",
    ]);
    expect(validateEmail(`${"a".repeat(250)}@example.com`)).toEqual([
      "メールアドレスは 254 文字までです",
    ]);
  });
});

describe("パスワード", () => {
  it(`${MIN_PASSWORD} 文字以上なら、文字の種類は問わない`, () => {
    expect(validatePassword("a".repeat(MIN_PASSWORD))).toEqual([]);
    expect(validatePassword("たびのしおりをつくろう")).toEqual([]);
  });
  it("短い・空なら知らせる", () => {
    expect(validatePassword("")).toEqual(["パスワードを入力してください"]);
    expect(validatePassword("a".repeat(MIN_PASSWORD - 1))).toEqual([
      `パスワードは ${MIN_PASSWORD} 文字以上にしてください`,
    ]);
  });
  it("前後の空白は、うっかり入れた可能性があるので受け付けない", () => {
    expect(validatePassword(` ${"a".repeat(MIN_PASSWORD)}`)).toEqual([
      "パスワードの最初と最後に空白は使えません",
    ]);
  });
  it("長すぎるなら知らせる", () => {
    expect(validatePassword("a".repeat(257))).toEqual(["パスワードは 256 文字までです"]);
  });
});

describe("確認コード", () => {
  it("6 桁の数字。前後の空白は無視する", () => {
    expect(validateCode("123456")).toEqual([]);
    expect(validateCode(" 123456 ")).toEqual([]);
  });
  it("空・桁が違う・数字でないなら知らせる", () => {
    expect(validateCode("")).toEqual(["確認コードを入力してください"]);
    expect(validateCode("12345")).toEqual(["確認コードは、メールに書かれた 6 桁の数字です"]);
    expect(validateCode("12345a")).toEqual(["確認コードは、メールに書かれた 6 桁の数字です"]);
  });
});

describe("表示名", () => {
  it("1〜20 文字", () => {
    expect(validateDisplayName("たろう")).toEqual([]);
    expect(validateDisplayName("")).toEqual(["表示名を入力してください"]);
    expect(validateDisplayName("   ")).toEqual(["表示名を入力してください"]);
    expect(validateDisplayName("あ".repeat(21))).toEqual(["表示名は 20 文字までです"]);
  });
});
