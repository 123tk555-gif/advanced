import { generateKeyBetween } from "fractional-indexing";
import { beforeAll, describe, expect, it } from "vitest";
import { useTestApi } from "./helpers.js";

const api = useTestApi();

beforeAll(async () => {
  await api.signUp("u-owner", "オーナー");
});

let count = 0;
/** オーナーとメンバー 2 人の旅を作る */
async function freshTrip() {
  const trip = await api.createTrip("u-owner");
  const a = `u-ia${++count}`;
  const b = `u-ib${count}`;
  await api.addMember(trip, "u-owner", a);
  await api.addMember(trip, "u-owner", b);
  const base = `/trips/${trip.tripId}/ideas`;
  return { ...trip, base, a, b };
}

const newIdea = (change: Record<string, unknown> = {}) => ({
  name: "平等院",
  place: { label: "平等院", placeId: "p-byodoin" },
  note: "抹茶スイーツも",
  ...change,
});

async function ideas(tripId: string, userId = "u-owner") {
  return (await api.call(userId, "GET", `/trips/${tripId}`)).body.ideas;
}

describe("候補を出す・消す", () => {
  it("候補を出すと 201。票は 0 で、旅の画面に出る", async () => {
    const t = await freshTrip();
    const res = await api.call(t.a, "POST", t.base, newIdea());
    expect(res.status).toBe(201);
    expect(res.body.idea).toEqual({
      ideaId: expect.any(String),
      ...newIdea(),
      createdBy: t.a,
      createdAt: expect.any(String),
      voteCount: 0,
      voters: [],
      myVote: false,
      adoptedItemId: null,
    });
    expect(await ideas(t.tripId)).toHaveLength(1);
  });

  it("場所とひとことは省略できる", async () => {
    const t = await freshTrip();
    const res = await api.call(t.a, "POST", t.base, { name: "どこか海の見える所" });
    expect(res.status).toBe(201);
    expect(res.body.idea).toMatchObject({ place: null, note: "" });
  });

  it.each([
    ["名前が空", { name: "  " }],
    ["名前が 101 文字", { name: "あ".repeat(101) }],
    ["ひとことが 101 文字", { note: "あ".repeat(101) }],
  ])("内容が正しくない(%s)と 400", async (_label, change) => {
    const t = await freshTrip();
    expect((await api.call(t.a, "POST", t.base, newIdea(change))).status).toBe(400);
  });

  it("出した本人とオーナーは消せる。ほかのメンバーは 403", async () => {
    const t = await freshTrip();
    const mine = (await api.call(t.a, "POST", t.base, newIdea())).body.idea.ideaId;
    const other = (await api.call(t.a, "POST", t.base, newIdea())).body.idea.ideaId;

    expect((await api.call(t.b, "DELETE", `${t.base}/${mine}`)).status).toBe(403);
    expect((await api.call(t.a, "DELETE", `${t.base}/${mine}`)).status).toBe(204);
    expect((await api.call("u-owner", "DELETE", `${t.base}/${other}`)).status).toBe(204);
    expect(await ideas(t.tripId)).toEqual([]);
    expect((await api.call(t.a, "DELETE", `${t.base}/${mine}`)).status).toBe(404);
  });

  it("投票のある候補を消すと、投票も消える", async () => {
    const t = await freshTrip();
    const id = (await api.call(t.a, "POST", t.base, newIdea())).body.idea.ideaId;
    await api.call(t.b, "PUT", `${t.base}/${id}/vote`);
    await api.call(t.a, "DELETE", `${t.base}/${id}`);
    // 同じ名前でもう一度出しても、前の投票は引き継がれない
    const again = (await api.call(t.a, "POST", t.base, newIdea())).body.idea;
    expect(again.voteCount).toBe(0);
  });

  it("1 つの旅の候補は 100 件まで", async () => {
    const t = await freshTrip();
    for (let i = 0; i < 100; i++) {
      expect((await api.call(t.a, "POST", t.base, { name: `候補${i}` })).status).toBe(201);
    }
    const over = await api.call(t.a, "POST", t.base, { name: "101 件目" });
    expect(over.status).toBe(409);
    expect(over.body.error).toBe("TOO_MANY_IDEAS");
    // 消すと空きができる
    const first = (await ideas(t.tripId))[0].ideaId;
    await api.call("u-owner", "DELETE", `${t.base}/${first}`);
    expect((await api.call(t.a, "POST", t.base, { name: "空きに入れる" })).status).toBe(201);
  }, 60_000);
});

describe("投票", () => {
  it("投票・取り消しで票数が変わり、誰が投票したかがわかる", async () => {
    const t = await freshTrip();
    const id = (await api.call(t.a, "POST", t.base, newIdea())).body.idea.ideaId;

    expect((await api.call(t.a, "PUT", `${t.base}/${id}/vote`)).status).toBe(204);
    expect((await api.call(t.b, "PUT", `${t.base}/${id}/vote`)).status).toBe(204);
    let [idea] = await ideas(t.tripId, t.a);
    expect(idea).toMatchObject({ voteCount: 2, myVote: true });
    expect([...idea.voters].sort()).toEqual([t.a, t.b].sort());

    expect((await api.call(t.a, "DELETE", `${t.base}/${id}/vote`)).status).toBe(204);
    [idea] = await ideas(t.tripId, t.a);
    expect(idea).toMatchObject({ voteCount: 1, myVote: false, voters: [t.b] });
  });

  it("2 回投票しても 1 票。投票していないのに取り消しても減らない", async () => {
    const t = await freshTrip();
    const id = (await api.call(t.a, "POST", t.base, newIdea())).body.idea.ideaId;
    await api.call(t.a, "PUT", `${t.base}/${id}/vote`);
    await api.call(t.a, "PUT", `${t.base}/${id}/vote`);
    expect((await ideas(t.tripId))[0].voteCount).toBe(1);

    expect((await api.call(t.b, "DELETE", `${t.base}/${id}/vote`)).status).toBe(204);
    expect((await ideas(t.tripId))[0].voteCount).toBe(1);
  });

  it("同じ人が同時に 2 回押しても 1 票。3 人が同時に押せば 3 票", async () => {
    const t = await freshTrip();
    const id = (await api.call(t.a, "POST", t.base, newIdea())).body.idea.ideaId;
    const url = `${t.base}/${id}/vote`;
    await Promise.all([api.call(t.a, "PUT", url), api.call(t.a, "PUT", url)]);
    expect((await ideas(t.tripId))[0].voteCount).toBe(1);

    await Promise.all([
      api.call(t.b, "PUT", url),
      api.call("u-owner", "PUT", url),
      api.call(t.a, "PUT", url),
    ]);
    expect((await ideas(t.tripId))[0].voteCount).toBe(3);
  });

  it("無い候補への投票は 404", async () => {
    const t = await freshTrip();
    expect((await api.call(t.a, "PUT", `${t.base}/NOSUCHIDEA/vote`)).status).toBe(404);
  });

  it("票の多い順に並ぶ", async () => {
    const t = await freshTrip();
    const few = (await api.call(t.a, "POST", t.base, { name: "少ない" })).body.idea.ideaId;
    const many = (await api.call(t.a, "POST", t.base, { name: "多い" })).body.idea.ideaId;
    await api.call(t.a, "PUT", `${t.base}/${few}/vote`);
    await api.call(t.a, "PUT", `${t.base}/${many}/vote`);
    await api.call(t.b, "PUT", `${t.base}/${many}/vote`);
    expect((await ideas(t.tripId)).map((i: { name: string }) => i.name)).toEqual([
      "多い",
      "少ない",
    ]);
  });
});

describe("候補を旅程に入れる(採用)", () => {
  const order = generateKeyBetween(null, null);

  it("候補の名前・場所・ひとことで予定ができ、候補は採用済みになる", async () => {
    const t = await freshTrip();
    const id = (await api.call(t.a, "POST", t.base, newIdea())).body.idea.ideaId;
    const res = await api.call(t.b, "POST", `${t.base}/${id}/adopt`, { day: 2, order });
    expect(res.status).toBe(201);
    expect(res.body.item).toMatchObject({
      day: 2,
      title: "平等院",
      place: newIdea().place,
      memo: "抹茶スイーツも",
      time: "",
      version: 1,
      updatedBy: t.b,
    });
    const view = (await api.call("u-owner", "GET", `/trips/${t.tripId}`)).body;
    expect(view.items).toHaveLength(1);
    expect(view.ideas[0].adoptedItemId).toBe(res.body.item.itemId);
  });

  it("採用済みの候補をもう一度採用すると 409", async () => {
    const t = await freshTrip();
    const id = (await api.call(t.a, "POST", t.base, newIdea())).body.idea.ideaId;
    await api.call(t.a, "POST", `${t.base}/${id}/adopt`, { day: 1, order });
    const again = await api.call(t.b, "POST", `${t.base}/${id}/adopt`, { day: 1, order });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("ALREADY_ADOPTED");
  });

  it("2 人が同時に採用しても、予定は 1 件だけできる", async () => {
    const t = await freshTrip();
    const id = (await api.call(t.a, "POST", t.base, newIdea())).body.idea.ideaId;
    const url = `${t.base}/${id}/adopt`;
    const results = await Promise.all([
      api.call(t.a, "POST", url, { day: 1, order }),
      api.call(t.b, "POST", url, { day: 2, order }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const view = (await api.call("u-owner", "GET", `/trips/${t.tripId}`)).body;
    expect(view.items).toHaveLength(1);
  });

  it("旅の日数を超える日・無い候補は採用できない", async () => {
    const t = await freshTrip();
    const id = (await api.call(t.a, "POST", t.base, newIdea())).body.idea.ideaId;
    expect((await api.call(t.a, "POST", `${t.base}/${id}/adopt`, { day: 4, order })).status).toBe(
      400,
    );
    expect(
      (await api.call(t.a, "POST", `${t.base}/NOSUCHIDEA/adopt`, { day: 1, order })).status,
    ).toBe(404);
    // 失敗した採用では予定もできていない
    expect((await api.call("u-owner", "GET", `/trips/${t.tripId}`)).body.items).toEqual([]);
  });
});
