/**
 * 公開の後の確かめ(読むだけ。データは作らず、メールも送らない)。
 * 公開のたびに流し、手元の E2E では見つからない本番だけの誤り(CORS の下見、Lambda の中身など)を見つける。
 */
export interface SmokeOutputs {
  SiteUrl: string;
  ApiUrl: string;
  WsUrl: string;
  UserPoolId: string;
}

export interface HttpRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
}

export interface HttpResponse {
  status: number;
  /** 名前は小文字 */
  headers: Record<string, string>;
  body: string;
}

/** 通信の部品(テストで差し替える) */
export interface Probe {
  http(req: HttpRequest): Promise<HttpResponse>;
  /** WebSocket の接続を試み、返ってきた HTTP の状態番号(接続できたら 101) */
  wsHandshake(url: string, origin: string): Promise<number>;
}

export interface SmokeResult {
  name: string;
  ok: boolean;
  detail: string;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export async function runSmoke(o: SmokeOutputs, probe: Probe): Promise<SmokeResult[]> {
  const results: SmokeResult[] = [];
  const check = async (name: string, run: () => Promise<string | null>) => {
    try {
      const problem = await run();
      results.push({ name, ok: problem === null, detail: problem ?? "OK" });
    } catch (error) {
      results.push({ name, ok: false, detail: `通信できない: ${(error as Error).message}` });
    }
  };
  const site = o.SiteUrl.replace(/\/$/, "");
  const api = o.ApiUrl.replace(/\/$/, "");

  // ---- 画面 ----
  let top: HttpResponse | null = null;
  await check("画面: トップが開ける", async () => {
    top = await probe.http({ method: "GET", url: `${site}/` });
    return top.status === 200 ? null : `状態 ${top.status}`;
  });
  await check("画面: API と Cognito の場所が埋め込まれている", async () => {
    const res = top ?? (await probe.http({ method: "GET", url: `${site}/` }));
    const missing = [api, o.UserPoolId].filter((v) => !res.body.includes(v));
    return missing.length ? `見つからない: ${missing.join(", ")}` : null;
  });
  await check("画面: 中の URL(/trips/…)も開ける", async () => {
    const res = await probe.http({ method: "GET", url: `${site}/trips/smoke-check` });
    return res.status === 200 ? null : `状態 ${res.status}`;
  });
  await check("画面: 安全のヘッダーが付いている", async () => {
    const res = top ?? (await probe.http({ method: "GET", url: `${site}/` }));
    const need = ["strict-transport-security", "x-frame-options", "x-content-type-options"];
    const missing = need.filter((h) => !res.headers[h]);
    return missing.length ? `無い: ${missing.join(", ")}` : null;
  });

  // ---- API ----
  for (const method of METHODS) {
    await check(`API: 画面からの下見(${method})が通る`, async () => {
      const res = await probe.http({
        method: "OPTIONS",
        url: `${api}/me`,
        headers: {
          origin: site,
          "access-control-request-method": method,
          "access-control-request-headers": "authorization,content-type",
        },
      });
      if (res.status < 200 || res.status >= 300)
        return `状態 ${res.status}(2xx でないとブラウザは本番の通信を送らない)`;
      return res.headers["access-control-allow-origin"] === site
        ? null
        : `access-control-allow-origin が ${res.headers["access-control-allow-origin"] ?? "無い"}`;
    });
  }
  await check("API: よそのサイトからの下見は許さない", async () => {
    const res = await probe.http({
      method: "OPTIONS",
      url: `${api}/me`,
      headers: { origin: "https://evil.example", "access-control-request-method": "GET" },
    });
    const allowed = res.headers["access-control-allow-origin"];
    return allowed ? `許している: ${allowed}` : null;
  });
  await check(
    "API: ログインが要る道は、トークンなしで 401(画面が読めるよう CORS つき)",
    async () => {
      const res = await probe.http({ method: "GET", url: `${api}/me`, headers: { origin: site } });
      if (res.status !== 401) return `状態 ${res.status}`;
      return res.headers["access-control-allow-origin"] === site ? null : "CORS のヘッダーが無い";
    },
  );
  await check("API: 公開しおりの道で Lambda まで届く(無いしおりは JSON の 404)", async () => {
    const res = await probe.http({ method: "GET", url: `${api}/public/smoke-check-no-such-token` });
    if (res.status !== 404) return `状態 ${res.status}`;
    return res.body.includes('"NOT_FOUND"') ? null : `中身が違う: ${res.body.slice(0, 80)}`;
  });

  // ---- WebSocket ----
  await check("WebSocket: チケットなしの接続は、WebSocket の Lambda が 403 で断る", async () => {
    const status = await probe.wsHandshake(o.WsUrl, site);
    return status === 403 ? null : `状態 ${status}`;
  });

  return results;
}
