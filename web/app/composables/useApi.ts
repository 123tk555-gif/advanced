/** API がエラーを返したとき(status と、API の error コード) */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: unknown,
  ) {
    super(`${status} ${code}`);
  }
}

/** 開発用 API で、ログイン中の利用者を伝えるヘッダー(本番は Cognito のトークンを送る) */
const DEV_USER_HEADER = "x-dev-user-id";

/** API を呼ぶ。ログイン中なら利用者を添え、失敗したら ApiError を投げる */
export function useApi() {
  const config = useRuntimeConfig();
  const { user, logout } = useAuth();

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (user.value) headers[DEV_USER_HEADER] = user.value.userId;
    if (body !== undefined) headers["content-type"] = "application/json";

    let res: Response;
    try {
      res = await fetch(`${config.public.apiBase}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new ApiError(0, "NETWORK", null);
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      if (res.status === 401 && user.value) {
        // ログインが切れた: ログイン画面へ
        logout();
        await navigateTo({ path: "/login", query: { returnTo: useRoute().fullPath } });
      }
      throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? "UNKNOWN", data);
    }
    return data as T;
  }

  return {
    get: <T>(path: string) => request<T>("GET", path),
    post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
    put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
    patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
    del: <T>(path: string) => request<T>("DELETE", path),
  };
}

/** API のエラーを、画面に出す日本語にする */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "うまくいきませんでした。もう一度試してください";
  const messages: Record<string, string> = {
    NETWORK: "サーバーにつながりません。通信の状態を確かめてください",
    VALIDATION: "入力の内容を確かめてください",
    NOT_FOUND: "見つかりません。ほかの人が消した可能性があります",
    FORBIDDEN: "この操作はできません",
    TRIP_FULL: "メンバーが上限(50 人)に達しています",
    TOO_MANY_ITEMS: "予定は 1 つの旅に 300 件までです",
    TOO_MANY_IDEAS: "候補は 1 つの旅に 100 件までです",
    TOO_MANY_EXPENSES: "支出は 1 つの旅に 500 件までです",
    TOO_MANY_COMMENTS: "コメントは 1 つの予定に 200 件までです",
    TOO_MANY_JOIN_REQUESTS: "この旅は申請が多いため、今は申請できません",
    DAY_OUT_OF_RANGE: "旅の日数の範囲で日にちを選んでください",
    ITEMS_OUT_OF_RANGE: "予定がある日より短くはできません。先に予定を動かしてください",
    ALREADY_ADOPTED: "この候補は、もう旅程に入っています",
    ALREADY_MEMBER: "もうこの旅のメンバーです",
    NOT_A_MEMBER: "払った人・分け合う人は、今のメンバーから選んでください",
    OWNER_MUST_TRANSFER: "オーナーは、先にほかのメンバーにオーナーを引き継いでください",
    VERSION_CONFLICT: "ほかの人が先に変更しました",
    PAYLOAD_TOO_LARGE: "内容が大きすぎます",
  };
  return messages[error.code] ?? "うまくいきませんでした。もう一度試してください";
}
