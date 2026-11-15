import { beforeAll, describe, expect, it } from "vitest";
import { useTestApi } from "./helpers.js";

/**
 * ルートの棚卸しテスト。
 * app に登録された API を自動で列挙して確かめるので、API を足すと自動でこのテストの対象になる。
 * ログインやメンバーの確認を書き忘れた API があれば、ここが失敗する。
 */
const api = useTestApi();

/** ログインなしで使ってよい API(公開しおりを作るときに足す) */
const PUBLIC_ROUTES: string[] = ["/public/:token"];

let tripId = "";

beforeAll(async () => {
  await api.signUp("u-owner", "オーナー");
  await api.signUp("u-stranger", "よその人");
  ({ tripId } = await api.createTrip("u-owner"));
});

function listRoutes() {
  const seen = new Set<string>();
  return api.app.routes
    .filter((r) => r.method !== "ALL") // app.use で登録したミドルウェアは除く
    .map((r) => ({ method: r.method, path: r.path }))
    .filter((r) => {
      const key = `${r.method} ${r.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** GET には本文を付けられないので、それ以外にだけ空の JSON を付ける */
function bodyFor(method: string) {
  return method === "GET" ? undefined : {};
}

/** `:tripId` は本物の旅の ID に、それ以外の `:xxx` は適当な値に置き換える */
function fill(path: string, id: string) {
  return path.replace(":tripId", id).replace(/:[A-Za-z]+/g, "x");
}

describe("ルートの棚卸し", () => {
  it("API が列挙できている(列挙の仕組みが壊れていないことの確認)", () => {
    const routes = listRoutes().map((r) => `${r.method} ${r.path}`);
    expect(routes).toContain("GET /trips/:tripId");
    expect(routes).toContain("POST /trips/:tripId/join-requests/:userId/approve");
    // 許可リストの API が実在すること(消したのにリストに残っていないか)
    for (const path of PUBLIC_ROUTES) expect(routes.some((r) => r.endsWith(` ${path}`))).toBe(true);
  });

  it("公開 API 以外は、ログインしていないと 401", async () => {
    const failures: string[] = [];
    for (const r of listRoutes()) {
      if (PUBLIC_ROUTES.includes(r.path)) continue;
      const res = await api.call(null, r.method, fill(r.path, tripId), bodyFor(r.method));
      if (res.status !== 401) failures.push(`${r.method} ${r.path} → ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  it("旅の API は、メンバー以外には旅が無いときと同じ 404", async () => {
    const tripRoutes = listRoutes().filter((r) => r.path.includes(":tripId"));
    expect(tripRoutes.length).toBeGreaterThan(0);

    const failures: string[] = [];
    for (const r of tripRoutes) {
      const body = bodyFor(r.method);
      const real = await api.call("u-stranger", r.method, fill(r.path, tripId), body);
      const none = await api.call("u-stranger", r.method, fill(r.path, "NOSUCHTRIP"), body);
      if (real.status !== 404 || JSON.stringify(real.body) !== JSON.stringify(none.body)) {
        failures.push(`${r.method} ${r.path} → ${real.status} ${JSON.stringify(real.body)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("大きすぎるリクエストは 413", async () => {
    const res = await api.call("u-owner", "PUT", "/me", { displayName: "a".repeat(70_000) });
    expect(res.status).toBe(413);
  });
});
