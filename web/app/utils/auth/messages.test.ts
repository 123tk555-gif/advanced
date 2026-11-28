import { describe, expect, it } from "vitest";
import { authErrorMessage } from "./messages";

const named = (name: string) => Object.assign(new Error("english message"), { name });

describe("ログインの誤りを日本語にする", () => {
  it("メールかパスワードが違う。どちらが違うかは言わない(登録の有無を知られないように)", () => {
    const wrong = "メールアドレスかパスワードが違います";
    expect(authErrorMessage(named("NotAuthorizedException"))).toBe(wrong);
    expect(authErrorMessage(named("UserNotFoundException"))).toBe(wrong);
  });

  it("確認コードの誤り・期限切れ", () => {
    expect(authErrorMessage(named("CodeMismatchException"))).toBe(
      "確認コードが違います。メールに書かれた 6 桁の数字を入れてください",
    );
    expect(authErrorMessage(named("ExpiredCodeException"))).toBe(
      "確認コードの期限が切れました。コードを送り直してください",
    );
  });

  it("登録済み・パスワードの条件・試しすぎ", () => {
    expect(authErrorMessage(named("UsernameExistsException"))).toBe(
      "このメールアドレスは登録済みです。ログインするか、パスワードを再設定してください",
    );
    expect(authErrorMessage(named("InvalidPasswordException"))).toBe(
      "パスワードの条件を満たしていません。10 文字以上にしてください",
    );
    const tooMany = "試した回数が多すぎます。しばらく待ってから、もう一度試してください";
    expect(authErrorMessage(named("LimitExceededException"))).toBe(tooMany);
    expect(authErrorMessage(named("TooManyRequestsException"))).toBe(tooMany);
    expect(authErrorMessage(named("TooManyFailedAttemptsException"))).toBe(tooMany);
  });

  it("通信の失敗", () => {
    expect(authErrorMessage(named("NetworkError"))).toBe(
      "サーバーにつながりません。通信の状態を確かめてください",
    );
    expect(authErrorMessage(new TypeError("Failed to fetch"))).toBe(
      "サーバーにつながりません。通信の状態を確かめてください",
    );
  });

  it("知らない誤りは、英語の説明を出さずに一般的な言葉にする", () => {
    expect(authErrorMessage(named("SomethingNewException"))).toBe(
      "うまくいきませんでした。もう一度試してください",
    );
    expect(authErrorMessage("文字列")).toBe("うまくいきませんでした。もう一度試してください");
  });
});
