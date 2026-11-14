import { beforeAll, describe, expect, it } from "vitest";
import { useTestApi, validTrip } from "./helpers.js";

const api = useTestApi();

beforeAll(async () => {
  await api.signUp("u-owner", "オーナー");
  await api.signUp("u-other", "よその人");
});

describe("旅の作成(POST /trips)", () => {
  it("ログインしていないと 401", async () => {
    expect((await api.call(null, "POST", "/trips", validTrip)).status).toBe(401);
  });

  it("表示名を登録していないと 409", async () => {
    const res = await api.call("u-noprofile", "POST", "/trips", validTrip);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("PROFILE_REQUIRED");
  });

  it("作った人がオーナーで、メンバーは 1 人。招待リンクも発行される", async () => {
    const res = await api.call("u-owner", "POST", "/trips", validTrip);
    expect(res.status).toBe(201);
    expect(res.body.trip).toMatchObject({
      ...validTrip,
      ownerId: "u-owner",
      memberCount: 1,
    });
    expect(res.body.trip.tripId).toEqual(expect.any(String));
    expect(res.body.invite.token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    // 有効期限は 7 日後
    const days = (Date.parse(res.body.invite.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);
  });

  it("行き先は省略でき、タイトルの前後の空白は取り除く", async () => {
    const res = await api.call("u-owner", "POST", "/trips", {
      ...validTrip,
      title: "  日帰り  ",
      destination: undefined,
    });
    expect(res.status).toBe(201);
    expect(res.body.trip.title).toBe("日帰り");
    expect(res.body.trip.destination).toBe("");
  });

  it.each([
    ["タイトルが空", { title: " " }],
    ["タイトルが 51 文字", { title: "あ".repeat(51) }],
    ["行き先が 51 文字", { destination: "あ".repeat(51) }],
    ["日付の形が違う", { startDate: "2027/04/01" }],
    ["存在しない日付", { startDate: "2027-02-30" }],
    ["終わりが始まりより前", { startDate: "2027-04-03", endDate: "2027-04-01" }],
    ["31 日間", { startDate: "2027-04-01", endDate: "2027-05-01" }],
  ])("内容が正しくない(%s)と 400", async (_label, change) => {
    expect((await api.call("u-owner", "POST", "/trips", { ...validTrip, ...change })).status).toBe(
      400,
    );
  });

  it("30 日間までは作れる", async () => {
    const res = await api.call("u-owner", "POST", "/trips", {
      ...validTrip,
      startDate: "2027-04-01",
      endDate: "2027-04-30",
    });
    expect(res.status).toBe(201);
  });
});

describe("自分の旅の一覧(GET /trips)", () => {
  it("ログインしていないと 401", async () => {
    expect((await api.call(null, "GET", "/trips")).status).toBe(401);
  });

  it("参加している旅だけが、開始日の早い順に出る", async () => {
    await api.signUp("u-list", "一覧さん");
    await api.call("u-list", "POST", "/trips", {
      ...validTrip,
      title: "夏",
      startDate: "2027-08-01",
      endDate: "2027-08-02",
    });
    await api.call("u-list", "POST", "/trips", {
      ...validTrip,
      title: "春",
      startDate: "2027-03-01",
      endDate: "2027-03-02",
    });

    const res = await api.call("u-list", "GET", "/trips");
    expect(res.status).toBe(200);
    expect(res.body.trips.map((t: { title: string }) => t.title)).toEqual(["春", "夏"]);
    expect(res.body.trips[0]).toMatchObject({ role: "owner", memberCount: 1 });
    // 一覧では招待リンクを返さない(必要な画面でだけ返す)
    expect(JSON.stringify(res.body)).not.toMatch(/invite/i);
  });

  it("旅が無ければ空の一覧", async () => {
    const res = await api.call("u-other", "GET", "/trips");
    expect(res.status).toBe(200);
    expect(res.body.trips).toEqual([]);
  });
});

describe("旅を開く(GET /trips/:tripId)", () => {
  it("メンバーは、旅の情報とメンバーの一覧を見られる", async () => {
    const created = await api.call("u-owner", "POST", "/trips", validTrip);
    const tripId = created.body.trip.tripId;

    const res = await api.call("u-owner", "GET", `/trips/${tripId}`);
    expect(res.status).toBe(200);
    expect(res.body.trip).toMatchObject({ tripId, ...validTrip });
    expect(res.body.myRole).toBe("owner");
    expect(res.body.members).toEqual([
      { userId: "u-owner", displayName: "オーナー", role: "owner", joinedAt: expect.any(String) },
    ]);
    expect(res.body.invite).toEqual({ token: expect.any(String), expiresAt: expect.any(String) });
  });

  it("メンバーでない人には、旅が無いときと同じ 404(旅があることを知られない)", async () => {
    const created = await api.call("u-owner", "POST", "/trips", validTrip);
    const notMember = await api.call("u-other", "GET", `/trips/${created.body.trip.tripId}`);
    const notFound = await api.call("u-other", "GET", "/trips/01NOSUCHTRIP0000000000000");

    expect(notMember.status).toBe(404);
    expect(notMember.body).toEqual(notFound.body);
  });

  it("ログインしていないと 401", async () => {
    expect((await api.call(null, "GET", "/trips/anything")).status).toBe(401);
  });
});
