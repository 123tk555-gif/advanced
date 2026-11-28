import { type AuthProvider, type AuthSession, authError } from "./types";

/**
 * 試験用のログイン(Cognito の代わり)。自動テストで、会員登録・確認コード・パスワードの再設定の画面を通すため。
 * 確認コードは常に FAKE_CODE。利用者の ID はメールアドレスから作り、開発用 API に x-dev-user-id として送る。
 * パスワードは試験用なので、そのまま保存する(本番では使わない)。
 */
export const FAKE_CODE = "123456";

interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface Account {
  password: string;
  confirmed: boolean;
}

const ACCOUNTS = "tritri-fake-accounts";
const SESSION = "tritri-fake-session";

/** メールアドレスから、開発用 API が受け付ける形の ID を作る(同じメールなら同じ ID) */
function userIdOf(email: string): string {
  let h = 5381;
  for (const ch of email) h = (h * 33 + (ch.codePointAt(0) ?? 0)) >>> 0;
  const local =
    email
      .split("@")[0]
      ?.replace(/[^A-Za-z0-9]/g, "")
      .slice(0, 20) ?? "";
  return `f-${local}-${h.toString(36)}`.slice(0, 40);
}

export function createFakeAuth({
  accounts,
  session,
}: {
  accounts: Store;
  session: Store;
}): AuthProvider {
  const key = (email: string) => email.trim().toLowerCase();
  const load = (): Record<string, Account> => JSON.parse(accounts.getItem(ACCOUNTS) ?? "{}");
  const save = (all: Record<string, Account>) => accounts.setItem(ACCOUNTS, JSON.stringify(all));
  const current = (): string | null => session.getItem(SESSION);

  function existing(email: string): Account {
    const account = load()[key(email)];
    if (!account) throw authError("UserNotFoundException");
    return account;
  }
  function update(email: string, change: Partial<Account>) {
    const all = load();
    all[key(email)] = { ...existing(email), ...change };
    save(all);
  }
  function checkCode(code: string) {
    if (code.trim() !== FAKE_CODE) throw authError("CodeMismatchException");
  }

  return {
    async signUp(email, password) {
      const all = load();
      if (all[key(email)]) throw authError("UsernameExistsException");
      all[key(email)] = { password, confirmed: false };
      save(all);
    },
    async confirmSignUp(email, code) {
      existing(email);
      checkCode(code);
      update(email, { confirmed: true });
    },
    async resendSignUpCode(email) {
      existing(email);
    },
    async signIn(email, password) {
      const account = load()[key(email)];
      if (!account || account.password !== password) throw authError("NotAuthorizedException");
      if (!account.confirmed) throw authError("UserNotConfirmedException");
      session.setItem(SESSION, key(email));
    },
    async signOut() {
      session.removeItem(SESSION);
    },
    async resetPassword(email) {
      existing(email);
    },
    async confirmResetPassword(email, code, newPassword) {
      existing(email);
      checkCode(code);
      update(email, { password: newPassword, confirmed: true });
    },
    async currentSession(): Promise<AuthSession | null> {
      const email = current();
      if (!email || !load()[email]) return null;
      const userId = userIdOf(email);
      return { userId, token: userId };
    },
    async deleteUser() {
      const email = current();
      if (!email) return;
      const all = load();
      delete all[email];
      save(all);
      session.removeItem(SESSION);
    },
  };
}
