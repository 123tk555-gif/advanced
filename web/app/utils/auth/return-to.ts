/** ログイン・登録の画面。ここへは戻さない */
const AUTH_PAGES = ["/login", "/signup", "/password-reset"];

/**
 * ログイン後の戻り先。このサイトの中の場所だけを受け付ける。
 * 「//よそのサイト」「/\よそのサイト」はブラウザが別のサイトとして扱うので受け付けない。
 */
export function safeReturnTo(raw: unknown): string {
  if (typeof raw !== "string" || !/^\/(?![/\\])/.test(raw)) return "/trips";
  const path = raw.split(/[?#]/)[0] ?? "";
  if (AUTH_PAGES.some((p) => path === p || path.startsWith(`${p}/`))) return "/trips";
  return raw;
}
