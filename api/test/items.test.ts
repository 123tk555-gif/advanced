import { generateKeyBetween } from "fractional-indexing";
import { beforeAll, describe, expect, it } from "vitest";
import { useTestApi } from "./helpers.js";

const api = useTestApi();

// 3 日間の旅(validTrip: 2027-04-01 〜 04-03)
let trip: { tripId: string; inviteToken: string };
let base = "";

beforeAll(async () => {
  await api.signUp("u-owner", "オーナー");
  await api.signUp("u-stranger", "よその人");
  trip = await api.createTrip("u-owner");
  base = `/trips/${trip.tripId}/items`;
  await api.addMember(trip, "u-owner", "u-member");
});

/** 新しい旅を作り、その旅の予定 API の URL を返す(ほかのテストの予定と混ざらないように) */
let freshCount = 0;
async function freshTrip() {
  const t = await api.createTrip("u-owner");
  const member = `u-fresh${++freshCount}`;
  await api.addMember(t, "u-owner", member);
  return { ...t, base: `/trips/${t.tripId}/items`, member };
}

const first = generateKeyBetween(null, null);

const newItem = (change: Record<string, unknown> = {}) => ({
  day: 1,
  order: first,
  time: "09:00",
  title: "清水寺",
  place: { name: "清水寺", placeId: "ChIJB_vchdMIAWARujTEUIZlr2I", lat: 34.9949, lng: 135.785 },
  memo: "朝のうちに",
  ...change,
});

async function items(tripId: string, userId = "u-owner") {
  const res = await api.call(userId, "GET", `/trips/${tripId}`);
  return res.body.items as { itemId: string; title: string; version: number; day: number }[];
}

describe("予定の追加(POST /trips/:tripId/items)", () => {
  it("追加すると version 1 で、誰がいつ変えたかが入る", async () => {
    const res = await api.call("u-member", "POST", base, newItem());
    expect(res.status).toBe(201);
    expect(res.body.item).toEqual({
      itemId: expect.any(String),
      ...newItem(),
      version: 1,
      updatedBy: "u-member",
      updatedAt: expect.any(String),
    });
  });

  it("時刻・場所・メモは省略できる", async () => {
    const res = await api.call("u-owner", "POST", base, {
      day: 2,
      order: first,
      title: "自由行動",
    });
    expect(res.status).toBe(201);
    expect(res.body.item).toMatchObject({ time: "", place: null, memo: "" });
  });

  it("旅の画面では、日にち → 並び順の順に並ぶ", async () => {
    const t = await freshTrip();
    const a = generateKeyBetween(null, null);
    const c = generateKeyBetween(a, null);
    const b = generateKeyBetween(a, c); // a と c の間
    await api.call("u-owner", "POST", t.base, newItem({ day: 2, order: a, title: "2日目" }));
    await api.call("u-owner", "POST", t.base, newItem({ order: c, title: "C" }));
    await api.call("u-owner", "POST", t.base, newItem({ order: a, title: "A" }));
    await api.call("u-owner", "POST", t.base, newItem({ order: b, title: "B" }));

    expect((await items(t.tripId)).map((i) => i.title)).toEqual(["A", "B", "C", "2日目"]);
  });

  it.each([
    ["0 日目", { day: 0 }],
    ["旅の日数より後の日", { day: 4 }],
    ["日が小数", { day: 1.5 }],
    ["時刻の形が違う", { time: "9:00" }],
    ["ありえない時刻", { time: "24:00" }],
    ["タイトルが空", { title: "  " }],
    ["タイトルが 101 文字", { title: "あ".repeat(101) }],
    ["メモが 1001 文字", { memo: "あ".repeat(1001) }],
    ["緯度が範囲外", { place: { name: "どこか", lat: 91, lng: 0 } }],
    ["場所の名前が空", { place: { name: "", lat: 0, lng: 0 } }],
    ["並び順が空", { order: "" }],
    ["並び順の形が違う", { order: "!!" }],
  ])("内容が正しくない(%s)と 400", async (_label, change) => {
    expect((await api.call("u-owner", "POST", base, newItem(change))).status).toBe(400);
  });

  it("1 つの旅の予定は 300 件まで", async () => {
    const t = await freshTrip();
    let order: string | null = null;
    for (let i = 0; i < 300; i++) {
      order = generateKeyBetween(order, null);
      const res = await api.call("u-owner", "POST", t.base, newItem({ order, title: `予定${i}` }));
      expect(res.status).toBe(201);
    }
    const over = await api.call("u-owner", "POST", t.base, newItem({ order: "a0" }));
    expect(over.status).toBe(409);
    expect(over.body.error).toBe("TOO_MANY_ITEMS");
  }, 60_000);
});

describe("予定の更新(PATCH /trips/:tripId/items/:itemId)", () => {
  async function created(tripBase = base) {
    const res = await api.call("u-owner", "POST", tripBase, newItem());
    return res.body.item as { itemId: string; version: number };
  }

  it("正しい version なら更新でき、version が 1 増える。送らなかった項目は変わらない", async () => {
    const item = await created();
    const res = await api.call("u-member", "PATCH", `${base}/${item.itemId}`, {
      version: 1,
      title: "清水寺と二年坂",
    });
    expect(res.status).toBe(200);
    expect(res.body.item).toMatchObject({
      title: "清水寺と二年坂",
      memo: "朝のうちに",
      version: 2,
      updatedBy: "u-member",
    });
  });

  it("古い version なら 409 で、今の内容(誰が変えたか)を返す", async () => {
    const item = await created();
    await api.call("u-member", "PATCH", `${base}/${item.itemId}`, {
      version: 1,
      title: "先に変更",
    });

    const res = await api.call("u-owner", "PATCH", `${base}/${item.itemId}`, {
      version: 1,
      title: "後から変更",
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("VERSION_CONFLICT");
    expect(res.body.current).toMatchObject({
      itemId: item.itemId,
      title: "先に変更",
      version: 2,
      updatedBy: "u-member",
    });
  });

  it("2 人が同じ version から同時に更新すると、片方だけ成功する", async () => {
    const item = await created();
    const url = `${base}/${item.itemId}`;
    const results = await Promise.all([
      api.call("u-owner", "PATCH", url, { version: 1, title: "オーナー案" }),
      api.call("u-member", "PATCH", url, { version: 1, title: "メンバー案" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);

    const winner = results.find((r) => r.status === 200)?.body.item.title;
    const all = await items(trip.tripId);
    const saved = all.find((i) => i.itemId === item.itemId);
    expect(saved).toMatchObject({ title: winner, version: 2 });
  });

  it("並べ替え(別の日への移動)では、動かした予定だけが変わる", async () => {
    const t = await freshTrip();
    const a = generateKeyBetween(null, null);
    const b = generateKeyBetween(a, null);
    const ra = await api.call("u-owner", "POST", t.base, newItem({ order: a, title: "A" }));
    await api.call("u-owner", "POST", t.base, newItem({ order: b, title: "B" }));
    await api.call("u-owner", "POST", t.base, newItem({ day: 3, order: a, title: "3日目" }));

    // A を 3 日目の最後へ
    const moved = await api.call("u-owner", "PATCH", `${t.base}/${ra.body.item.itemId}`, {
      version: 1,
      day: 3,
      order: generateKeyBetween(a, null),
    });
    expect(moved.status).toBe(200);

    const after = await items(t.tripId);
    expect(after.map((i) => `${i.day}:${i.title}`)).toEqual(["1:B", "3:3日目", "3:A"]);
    // A 以外の version は 1 のまま
    expect(after.filter((i) => i.title !== "A").map((i) => i.version)).toEqual([1, 1]);
  });

  it.each([
    ["version が無い", { title: "x" }],
    ["変える項目が無い", { version: 1 }],
    ["旅の日数より後の日", { version: 1, day: 4 }],
    ["タイトルが空", { version: 1, title: "" }],
  ])("内容が正しくない(%s)と 400", async (_label, body) => {
    const item = await created();
    expect((await api.call("u-owner", "PATCH", `${base}/${item.itemId}`, body)).status).toBe(400);
  });

  it("無い予定・ほかの旅の予定は 404", async () => {
    const other = await freshTrip();
    const otherItem = await created(other.base);
    expect(
      (await api.call("u-owner", "PATCH", `${base}/NOSUCHITEM`, { version: 1, title: "x" })).status,
    ).toBe(404);
    // 自分がメンバーの旅の URL で、ほかの旅の予定 ID を指定しても触れない
    expect(
      (
        await api.call("u-member", "PATCH", `${base}/${otherItem.itemId}`, {
          version: 1,
          title: "x",
        })
      ).status,
    ).toBe(404);
  });
});

describe("予定の削除(DELETE /trips/:tripId/items/:itemId?version=)", () => {
  it("正しい version なら消え、旅の画面に出なくなる", async () => {
    const t = await freshTrip();
    const res = await api.call("u-owner", "POST", t.base, newItem());
    const url = `${t.base}/${res.body.item.itemId}`;

    expect((await api.call(t.member, "DELETE", `${url}?version=1`)).status).toBe(204);
    expect(await items(t.tripId)).toEqual([]);
    expect((await api.call(t.member, "DELETE", `${url}?version=1`)).status).toBe(404);
  });

  it("ほかの人が先に変えていたら消さずに 409", async () => {
    const t = await freshTrip();
    const res = await api.call("u-owner", "POST", t.base, newItem());
    const url = `${t.base}/${res.body.item.itemId}`;
    await api.call("u-owner", "PATCH", url, { version: 1, memo: "大事なメモ" });

    const del = await api.call(t.member, "DELETE", `${url}?version=1`);
    expect(del.status).toBe(409);
    expect(del.body.current.memo).toBe("大事なメモ");
    expect(await items(t.tripId)).toHaveLength(1);
  });

  it("消すと、予定の件数の上限にも空きができる", async () => {
    const t = await freshTrip();
    const res = await api.call("u-owner", "POST", t.base, newItem());
    await api.call("u-owner", "DELETE", `${t.base}/${res.body.item.itemId}?version=1`);
    const view = await api.call("u-owner", "GET", `/trips/${t.tripId}`);
    expect(view.status).toBe(200);
    // 内部の件数は応答に出さない
    expect(view.body.trip.itemCount).toBeUndefined();
  });

  it("version が無い・数でないと 400", async () => {
    const res = await api.call("u-owner", "POST", base, newItem());
    const url = `${base}/${res.body.item.itemId}`;
    expect((await api.call("u-owner", "DELETE", url)).status).toBe(400);
    expect((await api.call("u-owner", "DELETE", `${url}?version=abc`)).status).toBe(400);
  });
});

describe("メンバー以外", () => {
  it("予定を追加・更新・削除できない(旅が無いときと同じ 404)", async () => {
    const res = await api.call("u-owner", "POST", base, newItem());
    const url = `${base}/${res.body.item.itemId}`;
    expect((await api.call("u-stranger", "POST", base, newItem())).status).toBe(404);
    expect((await api.call("u-stranger", "PATCH", url, { version: 1, title: "x" })).status).toBe(
      404,
    );
    expect((await api.call("u-stranger", "DELETE", `${url}?version=1`)).status).toBe(404);
  });
});
