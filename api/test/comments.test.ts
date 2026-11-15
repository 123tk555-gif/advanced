import { generateKeyBetween } from "fractional-indexing";
import { beforeAll, describe, expect, it } from "vitest";
import { useTestApi } from "./helpers.js";

const api = useTestApi();

beforeAll(async () => {
  await api.signUp("u-owner", "オーナー");
});

let count = 0;
/** メンバー a・b がいて、予定が 1 件ある旅 */
async function tripWithItem() {
  const trip = await api.createTrip("u-owner");
  const a = `u-ca${++count}`;
  const b = `u-cb${count}`;
  await api.addMember(trip, "u-owner", a);
  await api.addMember(trip, "u-owner", b);
  const item = await api.call("u-owner", "POST", `/trips/${trip.tripId}/items`, {
    day: 1,
    order: generateKeyBetween(null, null),
    title: "伏見稲荷大社",
  });
  const itemId = item.body.item.itemId as string;
  return {
    ...trip,
    a,
    b,
    itemId,
    base: `/trips/${trip.tripId}/items/${itemId}/comments`,
  };
}

async function commentsOf(tripId: string, itemId: string) {
  const view = (await api.call("u-owner", "GET", `/trips/${tripId}`)).body;
  return view.items.find((i: { itemId: string }) => i.itemId === itemId)?.comments;
}

describe("コメント", () => {
  it("書くと 201。旅の画面では予定ごとに、古い順で名前つきで出る", async () => {
    const t = await tripWithItem();
    const first = await api.call(t.a, "POST", t.base, { body: "  歩きやすい靴で!  " });
    expect(first.status).toBe(201);
    expect(first.body.comment).toEqual({
      commentId: expect.any(String),
      itemId: t.itemId,
      userId: t.a,
      authorName: t.a,
      body: "歩きやすい靴で!",
      createdAt: expect.any(String),
    });
    await api.call(t.b, "POST", t.base, { body: "了解" });

    const list = await commentsOf(t.tripId, t.itemId);
    expect(list.map((c: { body: string }) => c.body)).toEqual(["歩きやすい靴で!", "了解"]);
  });

  it("コメントの無い予定は空の一覧", async () => {
    const t = await tripWithItem();
    expect(await commentsOf(t.tripId, t.itemId)).toEqual([]);
  });

  it.each([
    ["空", "   "],
    ["201 文字", "あ".repeat(201)],
  ])("本文が正しくない(%s)と 400", async (_label, body) => {
    const t = await tripWithItem();
    expect((await api.call(t.a, "POST", t.base, { body })).status).toBe(400);
  });

  it("無い予定・ほかの旅の予定には書けない(404)", async () => {
    const t = await tripWithItem();
    const other = await tripWithItem();
    const none = `/trips/${t.tripId}/items/NOSUCHITEM/comments`;
    expect((await api.call(t.a, "POST", none, { body: "x" })).status).toBe(404);
    // 自分の旅の URL に、ほかの旅の予定 ID を入れても書けない
    const cross = `/trips/${t.tripId}/items/${other.itemId}/comments`;
    expect((await api.call(t.a, "POST", cross, { body: "x" })).status).toBe(404);
    expect(await commentsOf(other.tripId, other.itemId)).toEqual([]);
  });

  it("消せるのは書いた本人だけ(ほかの人は 403。オーナーでも)", async () => {
    const t = await tripWithItem();
    const id = (await api.call(t.a, "POST", t.base, { body: "消すかも" })).body.comment.commentId;
    expect((await api.call(t.b, "DELETE", `${t.base}/${id}`)).status).toBe(403);
    expect((await api.call("u-owner", "DELETE", `${t.base}/${id}`)).status).toBe(403);
    expect((await api.call(t.a, "DELETE", `${t.base}/${id}`)).status).toBe(204);
    expect(await commentsOf(t.tripId, t.itemId)).toEqual([]);
    expect((await api.call(t.a, "DELETE", `${t.base}/${id}`)).status).toBe(404);
  });

  it("1 つの予定のコメントは 200 件まで。消すと空きができる", async () => {
    const t = await tripWithItem();
    let lastId = "";
    for (let i = 0; i < 200; i++) {
      const res = await api.call(t.a, "POST", t.base, { body: `${i}` });
      expect(res.status).toBe(201);
      lastId = res.body.comment.commentId;
    }
    const over = await api.call(t.a, "POST", t.base, { body: "201" });
    expect(over.status).toBe(409);
    expect(over.body.error).toBe("TOO_MANY_COMMENTS");
    await api.call(t.a, "DELETE", `${t.base}/${lastId}`);
    expect((await api.call(t.a, "POST", t.base, { body: "空き" })).status).toBe(201);
  }, 60_000);

  it("コメントを書いても、予定の版(version)は変わらない(同時編集の邪魔をしない)", async () => {
    const t = await tripWithItem();
    await api.call(t.a, "POST", t.base, { body: "メモ" });
    const res = await api.call("u-owner", "PATCH", `/trips/${t.tripId}/items/${t.itemId}`, {
      version: 1,
      title: "伏見稲荷(朝)",
    });
    expect(res.status).toBe(200);
  });

  it("予定を消すと、その予定のコメントも消える", async () => {
    const t = await tripWithItem();
    for (let i = 0; i < 30; i++) await api.call(t.a, "POST", t.base, { body: `${i}` });
    expect(await api.countRecords(t.tripId, `CMT#${t.itemId}#`)).toBe(30);

    const del = await api.call(
      "u-owner",
      "DELETE",
      `/trips/${t.tripId}/items/${t.itemId}?version=1`,
    );
    expect(del.status).toBe(204);
    expect(await api.countRecords(t.tripId, `CMT#${t.itemId}#`)).toBe(0);
  });
});
