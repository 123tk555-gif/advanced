import { generateKeyBetween } from "fractional-indexing";
import { beforeAll, describe, expect, it } from "vitest";
import { useTestApi, validTrip } from "./helpers.js";

const api = useTestApi();

beforeAll(async () => {
  await api.signUp("u-owner", "オーナー");
});

let count = 0;
/** オーナーとメンバー a・b の旅 */
async function freshTrip() {
  const trip = await api.createTrip("u-owner");
  const a = `u-ma${++count}`;
  const b = `u-mb${count}`;
  await api.addMember(trip, "u-owner", a);
  await api.addMember(trip, "u-owner", b);
  return { ...trip, a, b, url: `/trips/${trip.tripId}` };
}

const order = generateKeyBetween(null, null);

describe("旅の情報の変更(PATCH /trips/:tripId)", () => {
  it("オーナーは変えられ、旅の画面に反映される", async () => {
    const t = await freshTrip();
    const res = await api.call("u-owner", "PATCH", t.url, {
      ...validTrip,
      title: "京都 3 泊 4 日",
      endDate: "2027-04-04",
    });
    expect(res.status).toBe(200);
    expect(res.body.trip).toMatchObject({ title: "京都 3 泊 4 日", endDate: "2027-04-04" });
    expect((await api.call(t.a, "GET", t.url)).body.trip.title).toBe("京都 3 泊 4 日");
  });

  it("メンバーは変えられない(403)。内容が正しくなければ 400", async () => {
    const t = await freshTrip();
    expect((await api.call(t.a, "PATCH", t.url, validTrip)).status).toBe(403);
    expect((await api.call("u-owner", "PATCH", t.url, { ...validTrip, title: "" })).status).toBe(
      400,
    );
  });

  it("予定がある日より短くはできない(409)。予定の範囲内なら短くできる", async () => {
    const t = await freshTrip();
    await api.call("u-owner", "POST", `${t.url}/items`, { day: 2, order, title: "2 日目の予定" });
    const tooShort = await api.call("u-owner", "PATCH", t.url, {
      ...validTrip,
      endDate: "2027-04-01",
    });
    expect(tooShort.status).toBe(409);
    expect(tooShort.body.error).toBe("ITEMS_OUT_OF_RANGE");
    const ok = await api.call("u-owner", "PATCH", t.url, { ...validTrip, endDate: "2027-04-02" });
    expect(ok.status).toBe(200);
  });
});

describe("メンバーを外す・抜ける", () => {
  it("オーナーがメンバーを外すと、その人は旅を開けなくなり、一覧からも消える", async () => {
    const t = await freshTrip();
    expect((await api.call("u-owner", "DELETE", `${t.url}/members/${t.a}`)).status).toBe(204);
    expect((await api.call(t.a, "GET", t.url)).status).toBe(404);
    expect((await api.call(t.a, "GET", "/trips")).body.trips).toEqual([]);
    const view = (await api.call("u-owner", "GET", t.url)).body;
    expect(view.trip.memberCount).toBe(2);
    expect(view.members.map((m: { userId: string }) => m.userId)).not.toContain(t.a);
  });

  it("外された人も、招待リンクから申請し直して承認されれば戻れる", async () => {
    const t = await freshTrip();
    await api.call("u-owner", "DELETE", `${t.url}/members/${t.a}`);
    expect((await api.call(t.a, "POST", `/join/${t.inviteToken}`)).status).toBe(201);
    await api.call("u-owner", "POST", `${t.url}/join-requests/${t.a}/approve`);
    expect((await api.call(t.a, "GET", t.url)).status).toBe(200);
  });

  it("オーナーは自分を外せない(400)。メンバーは人を外せない(403)。メンバーでない人は 404", async () => {
    const t = await freshTrip();
    expect((await api.call("u-owner", "DELETE", `${t.url}/members/u-owner`)).status).toBe(400);
    expect((await api.call(t.a, "DELETE", `${t.url}/members/${t.b}`)).status).toBe(403);
    expect((await api.call("u-owner", "DELETE", `${t.url}/members/u-nobody`)).status).toBe(404);
  });

  it("メンバーは自分から抜けられる。オーナーは先に引き継ぐ必要がある(409)", async () => {
    const t = await freshTrip();
    expect((await api.call(t.a, "POST", `${t.url}/leave`)).status).toBe(204);
    expect((await api.call(t.a, "GET", t.url)).status).toBe(404);

    const owner = await api.call("u-owner", "POST", `${t.url}/leave`);
    expect(owner.status).toBe(409);
    expect(owner.body.error).toBe("OWNER_MUST_TRANSFER");
  });

  it("抜けた人の支出・投票は残り、コメントの名前は「元メンバー」になる", async () => {
    const t = await freshTrip();
    await api.call(t.a, "POST", `${t.url}/expenses`, {
      title: "旅館",
      amount: 9000,
      paidBy: t.a,
      splitWith: ["u-owner", t.a, t.b],
    });
    const idea = await api.call(t.a, "POST", `${t.url}/ideas`, { name: "平等院" });
    await api.call(t.a, "PUT", `${t.url}/ideas/${idea.body.idea.ideaId}/vote`);
    const item = await api.call("u-owner", "POST", `${t.url}/items`, { day: 1, order, title: "x" });
    await api.call(t.a, "POST", `${t.url}/items/${item.body.item.itemId}/comments`, {
      body: "よろしく",
    });

    await api.call(t.a, "POST", `${t.url}/leave`);

    const view = (await api.call("u-owner", "GET", t.url)).body;
    expect(view.settlement).toEqual(
      expect.arrayContaining([
        { from: "u-owner", to: t.a, amount: 3000 },
        { from: t.b, to: t.a, amount: 3000 },
      ]),
    );
    expect(view.ideas[0].voteCount).toBe(1);
    expect(view.items[0].comments[0].authorName).toBe("元メンバー");
  });
});

describe("オーナーの引き継ぎ(POST /trips/:tripId/transfer)", () => {
  it("引き継ぐと相手がオーナーになり、前のオーナーはメンバーになる", async () => {
    const t = await freshTrip();
    const res = await api.call("u-owner", "POST", `${t.url}/transfer`, { userId: t.a });
    expect(res.status).toBe(204);

    const view = (await api.call(t.a, "GET", t.url)).body;
    expect(view.myRole).toBe("owner");
    expect(view.trip.ownerId).toBe(t.a);
    const roles = Object.fromEntries(
      view.members.map((m: { userId: string; role: string }) => [m.userId, m.role]),
    );
    expect(roles).toEqual({ "u-owner": "member", [t.a]: "owner", [t.b]: "member" });

    // 前のオーナーは、もうオーナーの操作はできない
    expect((await api.call("u-owner", "POST", `${t.url}/invite`)).status).toBe(403);
    // 前のオーナーは、引き継いだので抜けられる
    expect((await api.call("u-owner", "POST", `${t.url}/leave`)).status).toBe(204);
  });

  it("メンバーでない人・自分には引き継げない。メンバーは引き継ぎを行えない", async () => {
    const t = await freshTrip();
    expect(
      (await api.call("u-owner", "POST", `${t.url}/transfer`, { userId: "u-nobody" })).status,
    ).toBe(404);
    expect(
      (await api.call("u-owner", "POST", `${t.url}/transfer`, { userId: "u-owner" })).status,
    ).toBe(400);
    expect((await api.call(t.a, "POST", `${t.url}/transfer`, { userId: t.b })).status).toBe(403);
  });
});

describe("旅の削除(DELETE /trips/:tripId)", () => {
  it("オーナーが消すと、誰も開けず、一覧・招待リンク・公開リンクも使えなくなる", async () => {
    const t = await freshTrip();
    const pub = (await api.call("u-owner", "POST", `${t.url}/public`)).body.public.token;
    await api.call("u-owner", "POST", `${t.url}/items`, { day: 1, order, title: "予定" });
    await api.call(t.a, "POST", `${t.url}/ideas`, { name: "候補" });

    expect((await api.call(t.a, "DELETE", t.url)).status).toBe(403);
    expect((await api.call("u-owner", "DELETE", t.url)).status).toBe(204);

    for (const user of ["u-owner", t.a, t.b]) {
      expect((await api.call(user, "GET", t.url)).status).toBe(404);
      const list = (await api.call(user, "GET", "/trips")).body.trips;
      expect(list.map((x: { tripId: string }) => x.tripId)).not.toContain(t.tripId);
    }
    expect((await api.call(t.b, "GET", `/join/${t.inviteToken}`)).status).toBe(404);
    expect((await api.call(null, "GET", `/public/${pub}`)).status).toBe(404);
    // データも残っていない
    expect(await api.countRecords(t.tripId, "")).toBe(0);
  });
});

describe("表示名の変更と承認待ちの旅", () => {
  it("表示名を変えると、参加中の旅のメンバー一覧とコメントの名前も変わる", async () => {
    const t = await freshTrip();
    const item = await api.call("u-owner", "POST", `${t.url}/items`, { day: 1, order, title: "x" });
    await api.call(t.a, "POST", `${t.url}/items/${item.body.item.itemId}/comments`, { body: "hi" });

    await api.call(t.a, "PUT", "/me", { displayName: "新しい名前" });

    const view = (await api.call("u-owner", "GET", t.url)).body;
    expect(view.members.find((m: { userId: string }) => m.userId === t.a).displayName).toBe(
      "新しい名前",
    );
    expect(view.items[0].comments[0].authorName).toBe("新しい名前");
  });

  it("申請中の旅は、旅の一覧の「承認待ち」にタイトルだけが出る", async () => {
    const trip = await api.createTrip("u-owner", { title: "承認待ちテスト" });
    await api.signUp("u-waiter", "待つ人");
    await api.call("u-waiter", "POST", `/join/${trip.inviteToken}`);

    const before = (await api.call("u-waiter", "GET", "/trips")).body;
    expect(before.trips).toEqual([]);
    expect(before.pending).toEqual([{ title: "承認待ちテスト", requestedAt: expect.any(String) }]);

    await api.call("u-owner", "POST", `/trips/${trip.tripId}/join-requests/u-waiter/approve`);
    const after = (await api.call("u-waiter", "GET", "/trips")).body;
    expect(after.trips.map((x: { title: string }) => x.title)).toEqual(["承認待ちテスト"]);
    expect(after.pending).toEqual([]);
  });
});
