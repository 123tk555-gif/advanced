const NETWORK = "サーバーにつながりません。通信の状態を確かめてください";
const TOO_MANY = "試した回数が多すぎます。しばらく待ってから、もう一度試してください";
// メールが登録済みかどうかを知られないよう、どちらが違うかは言わない
const WRONG = "メールアドレスかパスワードが違います";

const MESSAGES: Record<string, string> = {
  NotAuthorizedException: WRONG,
  UserNotFoundException: WRONG,
  CodeMismatchException: "確認コードが違います。メールに書かれた 6 桁の数字を入れてください",
  ExpiredCodeException: "確認コードの期限が切れました。コードを送り直してください",
  UsernameExistsException:
    "このメールアドレスは登録済みです。ログインするか、パスワードを再設定してください",
  InvalidPasswordException: "パスワードの条件を満たしていません。10 文字以上にしてください",
  UserNotConfirmedException: "メールアドレスの確認がまだです。届いた確認コードを入れてください",
  LimitExceededException: TOO_MANY,
  TooManyRequestsException: TOO_MANY,
  TooManyFailedAttemptsException: TOO_MANY,
  CodeDeliveryFailureException:
    "確認コードのメールを送れませんでした。メールアドレスを確かめてください",
  NetworkError: NETWORK,
};

/** ログイン・会員登録の誤り(Cognito の name)を、画面に出す日本語にする */
export function authErrorMessage(error: unknown): string {
  if (error instanceof TypeError) return NETWORK; // fetch が通信できなかった
  const name = error instanceof Error ? error.name : "";
  return MESSAGES[name] ?? "うまくいきませんでした。もう一度試してください";
}
