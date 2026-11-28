import { createCognitoAuth } from "~/utils/auth/cognito";
import { createFakeAuth } from "~/utils/auth/fake";
import type { AuthProvider } from "~/utils/auth/types";

/**
 * ログイン中の利用者。ログインの仕組みは 3 つから選ぶ(nuxt.config の runtimeConfig)。
 * - cognito: 本番。Cognito のユーザープール ID とクライアント ID があれば、これになる
 * - fake: 試験用。メールアドレスとパスワードの画面を、Cognito なしで通す(自動テスト用)
 * - dev: 手元の開発用。利用者 ID と表示名を入れるだけで入れる(何も設定しなければ、これ)
 * dev と fake は、開発用 API に x-dev-user-id で利用者を伝える。cognito はアクセストークンを送る。
 */
export type AuthMode = "dev" | "fake" | "cognito";

export interface AuthUser {
  userId: string;
  /** まだ登録していなければ ""(表示名の登録の画面へ案内する) */
  displayName: string;
}

const DEV_KEY = "tritri-dev-user";
let provider: AuthProvider | null = null;
/** 開いたときに 1 回だけ、残っているログインと表示名を読む */
let readyPromise: Promise<void> | null = null;

function readDev(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(DEV_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

function writeDev(user: AuthUser | null) {
  try {
    if (user) sessionStorage.setItem(DEV_KEY, JSON.stringify(user));
    else sessionStorage.removeItem(DEV_KEY);
  } catch {
    // 保存できない環境でも、このタブを開いている間は使える
  }
}

export function useAuth() {
  const config = useRuntimeConfig().public;
  const mode: AuthMode = config.cognitoUserPoolId
    ? "cognito"
    : config.authMode === "fake"
      ? "fake"
      : "dev";
  const user = useState<AuthUser | null>("auth-user", () => (mode === "dev" ? readDev() : null));

  /** メールアドレスとパスワードのログインの仕組み(dev では使わない) */
  function emailAuth(): AuthProvider {
    if (!provider) {
      provider =
        mode === "cognito"
          ? createCognitoAuth({
              userPoolId: String(config.cognitoUserPoolId),
              clientId: String(config.cognitoClientId),
            })
          : createFakeAuth({ accounts: localStorage, session: sessionStorage });
    }
    return provider;
  }

  /** API へ送るトークン(dev は利用者 ID そのもの)。ログインしていなければ null */
  async function token(force = false): Promise<string | null> {
    if (mode === "dev") return user.value?.userId ?? null;
    try {
      return (await emailAuth().currentSession(force))?.token ?? null;
    } catch {
      return null;
    }
  }

  /** トークンを API に伝えるヘッダー */
  function headerFor(t: string): Record<string, string> {
    return mode === "cognito" ? { authorization: `Bearer ${t}` } : { "x-dev-user-id": t };
  }

  /** 開発用のログイン(利用者 ID と表示名だけ) */
  function devLogin(next: AuthUser) {
    user.value = next;
    writeDev(next);
  }

  /** ブラウザに残っているログインから、利用者を取り出す(表示名は呼ぶ側が /me から入れる) */
  async function restore(): Promise<AuthUser | null> {
    if (mode === "dev") return user.value;
    try {
      const session = await emailAuth().currentSession();
      user.value = session ? { userId: session.userId, displayName: "" } : null;
    } catch {
      user.value = null;
    }
    return user.value;
  }

  /** 表示名を /me から読む。まだ登録していなければ "" のまま */
  async function loadProfile() {
    if (!user.value) return;
    try {
      const profile = await useApi().get<{ displayName: string }>("/me");
      setDisplayName(profile.displayName);
    } catch {
      setDisplayName("");
    }
  }

  /** 画面を開いたときに、残っているログインを読み終えるまで待つ(dev はすぐ終わる) */
  function ready(): Promise<void> {
    if (mode === "dev") return Promise.resolve();
    readyPromise ??= (async () => {
      if (await restore()) await loadProfile();
    })();
    return readyPromise;
  }

  async function logout() {
    user.value = null;
    if (mode === "dev") writeDev(null);
    else
      await emailAuth()
        .signOut()
        .catch(() => {});
  }

  function setDisplayName(displayName: string) {
    if (!user.value) return;
    user.value = { ...user.value, displayName };
    if (mode === "dev") writeDev(user.value);
  }

  /** 退会の後に、ログインの仕組みからも利用者を消す */
  async function deleteAccount() {
    if (mode !== "dev") await emailAuth().deleteUser();
    await logout();
  }

  return {
    mode,
    user,
    token,
    headerFor,
    devLogin,
    restore,
    loadProfile,
    ready,
    logout,
    setDisplayName,
    deleteAccount,
    emailAuth,
  };
}
