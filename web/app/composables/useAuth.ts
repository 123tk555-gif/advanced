/**
 * ログイン中の利用者(開発用)。
 * 本番では Cognito のログインに置き換える。手元では利用者 ID と表示名を入れるだけで入れる。
 * タブごとに別の人で入れるよう、sessionStorage(タブごとの保存場所)に置く。
 */
export interface DevUser {
  userId: string;
  displayName: string;
}

const KEY = "tritri-dev-user";

function read(): DevUser | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DevUser) : null;
  } catch {
    return null;
  }
}

function write(user: DevUser | null) {
  try {
    if (user) sessionStorage.setItem(KEY, JSON.stringify(user));
    else sessionStorage.removeItem(KEY);
  } catch {
    // 保存できない環境でも、このタブを開いている間は使える
  }
}

export function useAuth() {
  const user = useState<DevUser | null>("auth-user", read);

  function login(next: DevUser) {
    user.value = next;
    write(next);
  }

  function logout() {
    user.value = null;
    write(null);
  }

  function setDisplayName(displayName: string) {
    if (user.value) login({ ...user.value, displayName });
  }

  return { user, login, logout, setDisplayName };
}
