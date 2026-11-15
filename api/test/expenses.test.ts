import { beforeAll, describe, expect, it } from "vitest";
import { useTestApi } from "./helpers.js";

const api = useTestApi();

beforeAll(async () => {
  await api.signUp("u-owner", "オーナー");
  await api.signUp("u-stranger", "よその人");
});

let count = 0;
/** オーナーとメンバー 2 人(a, b)の旅 */
async function freshTrip() {
  const trip = await api.createTrip("u-owner");
  const a = `u-ea${++count}`;
  const b = `u-eb${count}`;
  await api.addMember(trip, "u-owner", a);
  await api.addMember(trip, "u-owner", b);
  return { ...trip, base: `/trips/${trip.tripId}/expenses`, a, b, all: ["u-owner", a, b] };
}

async function view(tripId: string) {
  return (await api.call("u-owner", "GET", `/trips/${tripId}`)).body;
}

describe("支出の記録", () => {
  it("記録すると 201。旅の画面に支出と精算が出る", async () => {
    const t = await freshTrip();
    const res = await api.call(t.a, "POST", t.base, {
      title: "  新幹線  ",
      amount: 3000,
      paidBy: t.a,
      splitWith: t.all,
    });
    expect(res.status).toBe(201);
    expect(res.body.expense).toEqual({
      expenseId: expect.any(String),
      title: "新幹線",
      amount: 3000,
      paidBy: t.a,
      splitWith: t.all,
      createdBy: t.a,
      createdAt: expect.any(String),
    });

    const v = await view(t.tripId);
    expect(v.expenses).toHaveLength(1);
    expect(v.settlement).toEqual(
      expect.arrayContaining([
        { from: "u-owner", to: t.a, amount: 1000 },
        { from: t.b, to: t.a, amount: 1000 },
      ]),
    );
    expect(v.settlement).toHaveLength(2);
  });

  it("ほかの人の分を立て替えた記録もできる(払った人が分け合う人に入っていなくてよい)", async () => {
    const t = await freshTrip();
    const res = await api.call("u-owner", "POST", t.base, {
      title: "おみやげ",
      amount: 1001,
      paidBy: "u-owner",
      splitWith: [t.a, t.b],
    });
    expect(res.status).toBe(201);
    expect((await view(t.tripId)).settlement).toHaveLength(2);
  });

  it("分け合う人に同じ人が 2 回あっても 1 人にまとめる", async () => {
    const t = await freshTrip();
    const res = await api.call(t.a, "POST", t.base, {
      title: "タクシー",
      amount: 2000,
      paidBy: t.a,
      splitWith: [t.a, t.b, t.b],
    });
    expect(res.body.expense.splitWith).toEqual([t.a, t.b]);
  });

  it.each([
    ["内容が空", { title: " " }],
    ["内容が 51 文字", { title: "あ".repeat(51) }],
    ["0 円", { amount: 0 }],
    ["マイナス", { amount: -100 }],
    ["小数", { amount: 100.5 }],
    ["1000 万円を超える", { amount: 10_000_001 }],
    ["分け合う人が空", { splitWith: [] }],
    ["払った人が無い", { paidBy: "" }],
  ])("内容が正しくない(%s)と 400", async (_label, change) => {
    const t = await freshTrip();
    const body = { title: "昼ごはん", amount: 3000, paidBy: t.a, splitWith: t.all, ...change };
    expect((await api.call(t.a, "POST", t.base, body)).status).toBe(400);
  });

  it("1000 万円ちょうどまでは記録できる", async () => {
    const t = await freshTrip();
    const body = { title: "旅行代金", amount: 10_000_000, paidBy: t.a, splitWith: t.all };
    expect((await api.call(t.a, "POST", t.base, body)).status).toBe(201);
  });

  it("払った人・分け合う人は、今のメンバーだけ(よその人は 400)", async () => {
    const t = await freshTrip();
    const paid = await api.call(t.a, "POST", t.base, {
      title: "x",
      amount: 100,
      paidBy: "u-stranger",
      splitWith: t.all,
    });
    expect(paid.status).toBe(400);
    expect(paid.body.error).toBe("NOT_A_MEMBER");

    const split = await api.call(t.a, "POST", t.base, {
      title: "x",
      amount: 100,
      paidBy: t.a,
      splitWith: [t.a, "u-stranger"],
    });
    expect(split.status).toBe(400);
    expect(split.body.error).toBe("NOT_A_MEMBER");
  });

  it("1 つの旅の支出は 500 件まで", async () => {
    const t = await freshTrip();
    const body = { title: "おやつ", amount: 100, paidBy: t.a, splitWith: t.all };
    for (let i = 0; i < 500; i++) {
      expect((await api.call(t.a, "POST", t.base, body)).status).toBe(201);
    }
    const over = await api.call(t.a, "POST", t.base, body);
    expect(over.status).toBe(409);
    expect(over.body.error).toBe("TOO_MANY_EXPENSES");
  }, 120_000);
});

describe("支出の削除", () => {
  it("メンバーなら誰でも消せる。消すと精算も変わる", async () => {
    const t = await freshTrip();
    const created = await api.call(t.a, "POST", t.base, {
      title: "旅館",
      amount: 9000,
      paidBy: t.a,
      splitWith: t.all,
    });
    const url = `${t.base}/${created.body.expense.expenseId}`;
    expect((await api.call(t.b, "DELETE", url)).status).toBe(204);

    const v = await view(t.tripId);
    expect(v.expenses).toEqual([]);
    expect(v.settlement).toEqual([]);
    expect((await api.call(t.b, "DELETE", url)).status).toBe(404);
  });
});
