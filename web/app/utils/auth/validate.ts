/**
 * ログイン・会員登録の入力の確認(画面で先に確かめる。最終的な確認は Cognito が行う)。
 * パスワードの条件は Cognito の設定(infra)と合わせる: 10 文字以上、文字の種類は問わない。
 */
export const MIN_PASSWORD = 10;
const MAX_PASSWORD = 256;
const MAX_EMAIL = 254;

export function validateEmail(raw: string): string[] {
  const email = raw.trim();
  if (!email) return ["メールアドレスを入力してください"];
  if (email.length > MAX_EMAIL) return [`メールアドレスは ${MAX_EMAIL} 文字までです`];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return ["メールアドレスの形を確かめてください(例: taro@example.com)"];
  }
  return [];
}

export function validatePassword(password: string): string[] {
  if (!password) return ["パスワードを入力してください"];
  if (password !== password.trim()) return ["パスワードの最初と最後に空白は使えません"];
  if (password.length < MIN_PASSWORD)
    return [`パスワードは ${MIN_PASSWORD} 文字以上にしてください`];
  if (password.length > MAX_PASSWORD) return [`パスワードは ${MAX_PASSWORD} 文字までです`];
  return [];
}

export function validateCode(raw: string): string[] {
  const code = raw.trim();
  if (!code) return ["確認コードを入力してください"];
  if (!/^\d{6}$/.test(code)) return ["確認コードは、メールに書かれた 6 桁の数字です"];
  return [];
}

export function validateDisplayName(raw: string): string[] {
  const name = raw.trim();
  if (!name) return ["表示名を入力してください"];
  if (name.length > 20) return ["表示名は 20 文字までです"];
  return [];
}
