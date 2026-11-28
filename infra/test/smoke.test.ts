import { describe, expect, it } from "vitest";
import { type HttpResponse, type Probe, runSmoke, type SmokeOutputs } from "../lib/smoke.js";

const outputs: SmokeOutputs = {
  SiteUrl: "https://site.example",
  ApiUrl: "https://api.example",
  WsUrl: "wss://ws.example/prod",
  UserPoolId: "ap-northeast-1_POOL",
};

const SECURITY = {
  "strict-transport-security": "max-age=63072000; includeSubDomains",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
};

/** 正しく公開できているときの返事 */
function healthy(): Probe {
  return {
    async http(req): Promise<HttpResponse> {
      const origin = req.headers?.origin;
      const site = outputs.SiteUrl;
      if (req.url.startsWith(site)) {
        return {
          status: 200,
          headers: SECURITY,
          body: `<html>${outputs.ApiUrl} ${outputs.UserPoolId}</html>`,
        };
      }
      if (req.method === "OPTIONS") {
        return origin === site
          ? { status: 204, headers: { "access-control-allow-origin": site }, body: "" }
          : { status: 204, headers: {}, body: "" };
      }
      if (req.url.endsWith("/me")) {
        return { status: 401, headers: { "access-control-allow-origin": site }, body: "" };
      }
      if (req.url.includes("/public/")) {
        return { status: 404, headers: {}, body: '{"error":"NOT_FOUND"}' };
      }
      return { status: 500, headers: {}, body: "" };
    },
    async wsHandshake() {
      return 403;
    },
  };
}

const failedNames = async (probe: Probe) =>
  (await runSmoke(outputs, probe)).filter((r) => !r.ok).map((r) => r.name);

describe("公開の後の確かめ", () => {
  it("正しく公開できていれば、すべて合格", async () => {
    const results = await runSmoke(outputs, healthy());
    expect(results.length).toBeGreaterThanOrEqual(10);
    expect(results.filter((r) => !r.ok)).toEqual([]);
  });

  it("ブラウザの下見が JWT の確認に回って 401 になる(2026-11-28 の誤り)を見つける", async () => {
    const base = healthy();
    const probe: Probe = {
      ...base,
      async http(req) {
        if (req.method === "OPTIONS" && req.headers?.origin === outputs.SiteUrl) {
          return {
            status: 401,
            headers: { "access-control-allow-origin": outputs.SiteUrl },
            body: "",
          };
        }
        return base.http(req);
      },
    };
    const failed = await failedNames(probe);
    expect(failed.some((n) => n.includes("下見") && n.includes("GET"))).toBe(true);
    expect(failed.some((n) => n.includes("下見") && n.includes("PUT"))).toBe(true);
  });

  it("よそのサイトの下見を許していたら見つける", async () => {
    const base = healthy();
    const probe: Probe = {
      ...base,
      async http(req) {
        if (req.method === "OPTIONS") {
          return { status: 204, headers: { "access-control-allow-origin": "*" }, body: "" };
        }
        return base.http(req);
      },
    };
    expect((await failedNames(probe)).some((n) => n.includes("よそのサイト"))).toBe(true);
  });

  it("WebSocket の Lambda がチケットなしの接続を断らない(中身が違うコードなど)を見つける", async () => {
    const probe: Probe = { ...healthy(), wsHandshake: async () => 500 };
    expect((await failedNames(probe)).some((n) => n.includes("WebSocket"))).toBe(true);
  });

  it("API の Lambda が動かない・画面に API の場所が入っていない・安全のヘッダーが無い、を見つける", async () => {
    const base = healthy();
    const probe: Probe = {
      ...base,
      async http(req) {
        if (req.url.includes("/public/")) return { status: 502, headers: {}, body: "Bad Gateway" };
        if (req.url.startsWith(outputs.SiteUrl)) {
          return { status: 200, headers: {}, body: "<html>old</html>" };
        }
        return base.http(req);
      },
    };
    const failed = await failedNames(probe);
    expect(failed.some((n) => n.includes("公開しおり"))).toBe(true);
    expect(failed.some((n) => n.includes("埋め込"))).toBe(true);
    expect(failed.some((n) => n.includes("ヘッダー"))).toBe(true);
  });

  it("通信そのものが失敗しても止まらず、不合格として数える", async () => {
    const probe: Probe = {
      http: async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      },
      wsHandshake: async () => {
        throw new Error("timeout");
      },
    };
    const results = await runSmoke(outputs, probe);
    expect(results.every((r) => !r.ok)).toBe(true);
    expect(results[0]?.detail).toContain("ENOTFOUND");
  });
});
