import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { useTestApi } from "./helpers.js";

const api = useTestApi();

beforeAll(async () => {
  await api.signUp("u-owner", "オーナー");
  await api.signUp("u-guest", "ゲスト");
});

afterEach(() => {
  api.clock.reset();
});

describe("招待リンクを開く(GET /join/:token)", () => {
  it("旅のタイトル・メンバー数・自分の状態だけを返す", async () => {
    const trip = await api.createTrip("u-owner", { title: "沖縄" });
    const res = await api.call("u-guest", "GET", `/join/${trip.inviteToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ trip: { title: "沖縄", memberCount: 1 }, status: "none" });
  });

  it("申請後は pending、承認後は member と旅の ID", async () => {
    const trip = await api.createTrip("u-owner");
    await api.signUp("u-status");
    await api.call("u-status", "POST", `/join/${trip.inviteToken}`);
    expect((await api.call("u-status", "GET", `/join/${trip.inviteToken}`)).body.status).toBe(
      "pending",
    );

    await api.call("u-owner", "POST", `/trips/${trip.tripId}/join-requests/u-status/approve`);
    const res = await api.call("u-status", "GET", `/join/${trip.inviteToken}`);
    expect(res.body).toMatchObject({ status: "member", tripId: trip.tripId });
  });

  it("ログインしていないと 401", async () => {
    const trip = await api.createTrip("u-owner");
    expect((await api.call(null, "GET", `/join/${trip.inviteToken}`)).status).toBe(401);
  });
});

describe("使えない招待リンクは、存在しないリンクと同じ 404", () => {
  async function expectSameAsUnknown(token: string) {
    const res = await api.call("u-guest", "GET", `/join/${token}`);
    const unknown = await api.call("u-guest", "GET", "/join/unknown-token");
    expect(res.status).toBe(404);
    expect(res.body).toEqual(unknown.body);
    const post = await api.call("u-guest", "POST", `/join/${token}`);
    expect(post.status).toBe(404);
  }

  it("7 日を過ぎたリンク", async () => {
    const trip = await api.createTrip("u-owner");
    api.clock.advanceDays(6.9);
    expect((await api.call("u-guest", "GET", `/join/${trip.inviteToken}`)).status).toBe(200);
    api.clock.advanceDays(0.2);
    await expectSameAsUnknown(trip.inviteToken);
  });

  it("オーナーが停止したリンク", async () => {
    const trip = await api.createTrip("u-owner");
    expect((await api.call("u-owner", "DELETE", `/trips/${trip.tripId}/invite`)).status).toBe(204);
    await expectSameAsUnknown(trip.inviteToken);
    const view = await api.call("u-owner", "GET", `/trips/${trip.tripId}`);
    expect(view.body.invite).toBeNull();
  });

  it("発行し直す前のリンク(新しいリンクは使える)", async () => {
    const trip = await api.createTrip("u-owner");
    const res = await api.call("u-owner", "POST", `/trips/${trip.tripId}/invite`);
    expect(res.status).toBe(200);
    expect(res.body.invite.token).not.toBe(trip.inviteToken);

    await expectSameAsUnknown(trip.inviteToken);
    expect((await api.call("u-guest", "GET", `/join/${res.body.invite.token}`)).status).toBe(200);
  });

  it("期限切れのリンクも、発行し直せば新しい 7 日間使える", async () => {
    const trip = await api.createTrip("u-owner");
    api.clock.advanceDays(8);
    const res = await api.call("u-owner", "POST", `/trips/${trip.tripId}/invite`);
    expect((await api.call("u-guest", "GET", `/join/${res.body.invite.token}`)).status).toBe(200);
  });
});

describe("参加申請と承認", () => {
  it("申請しただけでは旅を開けない。オーナーが承認すると開ける", async () => {
    const trip = await api.createTrip("u-owner");
    await api.signUp("u-applicant", "申請者");

    const req = await api.call("u-applicant", "POST", `/join/${trip.inviteToken}`);
    expect(req.status).toBe(201);
    expect((await api.call("u-applicant", "GET", `/trips/${trip.tripId}`)).status).toBe(404);

    const list = await api.call("u-owner", "GET", `/trips/${trip.tripId}/join-requests`);
    expect(list.body.requests).toEqual([
      { userId: "u-applicant", displayName: "申請者", requestedAt: expect.any(String) },
    ]);

    const ok = await api.call(
      "u-owner",
      "POST",
      `/trips/${trip.tripId}/join-requests/u-applicant/approve`,
    );
    expect(ok.status).toBe(200);

    const view = await api.call("u-applicant", "GET", `/trips/${trip.tripId}`);
    expect(view.status).toBe(200);
    expect(view.body.myRole).toBe("member");
    expect(view.body.trip.memberCount).toBe(2);
    expect(view.body.members.map((m: { userId: string }) => m.userId)).toEqual([
      "u-owner",
      "u-applicant",
    ]);
    // 承認した申請は一覧から消える
    const after = await api.call("u-owner", "GET", `/trips/${trip.tripId}/join-requests`);
    expect(after.body.requests).toEqual([]);
  });

  it("メンバーも招待リンクを見られる(配れる)", async () => {
    const trip = await api.createTrip("u-owner");
    await api.addMember(trip, "u-owner", "u-sharer");
    const view = await api.call("u-sharer", "GET", `/trips/${trip.tripId}`);
    expect(view.body.invite.token).toBe(trip.inviteToken);
  });

  it("却下すると申請が消え、旅は開けないまま", async () => {
    const trip = await api.createTrip("u-owner");
    await api.signUp("u-rejected");
    await api.call("u-rejected", "POST", `/join/${trip.inviteToken}`);

    const res = await api.call(
      "u-owner",
      "POST",
      `/trips/${trip.tripId}/join-requests/u-rejected/reject`,
    );
    expect(res.status).toBe(204);
    expect((await api.call("u-rejected", "GET", `/trips/${trip.tripId}`)).status).toBe(404);
    const list = await api.call("u-owner", "GET", `/trips/${trip.tripId}/join-requests`);
    expect(list.body.requests).toEqual([]);
    // 却下された人の状態は「未申請」に戻る
    expect((await api.call("u-rejected", "GET", `/join/${trip.inviteToken}`)).body.status).toBe(
      "none",
    );
  });

  it("2 回申請しても 1 件", async () => {
    const trip = await api.createTrip("u-owner");
    await api.signUp("u-twice");
    expect((await api.call("u-twice", "POST", `/join/${trip.inviteToken}`)).status).toBe(201);
    expect((await api.call("u-twice", "POST", `/join/${trip.inviteToken}`)).status).toBe(200);
    const list = await api.call("u-owner", "GET", `/trips/${trip.tripId}/join-requests`);
    expect(list.body.requests).toHaveLength(1);
  });

  it("参加済みの人(オーナーを含む)の申請は 409", async () => {
    const trip = await api.createTrip("u-owner");
    const res = await api.call("u-owner", "POST", `/join/${trip.inviteToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("ALREADY_MEMBER");
  });

  it("表示名を登録していないと申請できない(409)", async () => {
    const trip = await api.createTrip("u-owner");
    const res = await api.call("u-noprofile", "POST", `/join/${trip.inviteToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("PROFILE_REQUIRED");
  });

  it("無い申請の承認・却下は 404", async () => {
    const trip = await api.createTrip("u-owner");
    const base = `/trips/${trip.tripId}/join-requests/u-nobody`;
    expect((await api.call("u-owner", "POST", `${base}/approve`)).status).toBe(404);
    expect((await api.call("u-owner", "POST", `${base}/reject`)).status).toBe(404);
  });
});

describe("オーナーだけができること", () => {
  it("メンバーは、申請の一覧・承認・却下・リンクの発行し直し・停止ができない(403)", async () => {
    const trip = await api.createTrip("u-owner");
    await api.addMember(trip, "u-owner", "u-plain");
    await api.signUp("u-waiting");
    await api.call("u-waiting", "POST", `/join/${trip.inviteToken}`);

    const base = `/trips/${trip.tripId}`;
    const attempts = [
      ["GET", `${base}/join-requests`],
      ["POST", `${base}/join-requests/u-waiting/approve`],
      ["POST", `${base}/join-requests/u-waiting/reject`],
      ["POST", `${base}/invite`],
      ["DELETE", `${base}/invite`],
    ] as const;
    for (const [method, path] of attempts) {
      const res = await api.call("u-plain", method, path);
      expect(res.status, `${method} ${path}`).toBe(403);
    }
    // 何も変わっていない
    const list = await api.call("u-owner", "GET", `${base}/join-requests`);
    expect(list.body.requests).toHaveLength(1);
    expect((await api.call("u-waiting", "GET", base)).status).toBe(404);
  });
});

describe("上限", () => {
  it("50 人の旅では承認できない。49 人の旅で 2 件を同時に承認しても 50 人を超えない", async () => {
    const trip = await api.createTrip("u-owner");
    for (let i = 2; i <= 49; i++) {
      await api.addMember(trip, "u-owner", `u-m${i}`);
    }
    await api.signUp("u-last1");
    await api.signUp("u-last2");
    await api.call("u-last1", "POST", `/join/${trip.inviteToken}`);
    await api.call("u-last2", "POST", `/join/${trip.inviteToken}`);

    const base = `/trips/${trip.tripId}/join-requests`;
    const results = await Promise.all([
      api.call("u-owner", "POST", `${base}/u-last1/approve`),
      api.call("u-owner", "POST", `${base}/u-last2/approve`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(results.find((r) => r.status === 409)?.body.error).toBe("TRIP_FULL");

    const view = await api.call("u-owner", "GET", `/trips/${trip.tripId}`);
    expect(view.body.trip.memberCount).toBe(50);
    expect(view.body.members).toHaveLength(50);
  }, 60_000);

  it("未処理の申請が 50 件ある旅には、それ以上申請できない", async () => {
    const trip = await api.createTrip("u-owner");
    for (let i = 1; i <= 50; i++) {
      await api.signUp(`u-r${i}`);
      expect((await api.call(`u-r${i}`, "POST", `/join/${trip.inviteToken}`)).status).toBe(201);
    }
    await api.signUp("u-r51");
    const res = await api.call("u-r51", "POST", `/join/${trip.inviteToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("TOO_MANY_JOIN_REQUESTS");
  }, 60_000);
});
