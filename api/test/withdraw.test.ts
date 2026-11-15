import { generateKeyBetween } from "fractional-indexing";
import { describe, expect, it } from "vitest";
import { useTestApi } from "./helpers.js";

const api = useTestApi();

const WITHDRAWN = "退会した会員";

describe("退会(DELETE /me)", () => {
  it("オーナーの旅は、いちばん早く参加したメンバーに引き継ぎ、名前は「退会した会員」になる", async () => {
    await api.signUp("u-leaver1", "去る人");
    const trip = await api.createTrip("u-leaver1");
    await api.addMember(trip, "u-leaver1", "u-first");
    await api.addMember(trip, "u-leaver1", "u-second");

    expect((await api.call("u-leaver1", "DELETE", "/me")).status).toBe(204);

    const view = (await api.call("u-first", "GET", `/trips/${trip.tripId}`)).body;
    expect(view.trip.ownerId).toBe("u-first");
    expect(view.myRole).toBe("owner");
    const leaver = view.members.find((m: { userId: string }) => m.userId === "u-leaver1");
    expect(leaver).toMatchObject({ displayName: WITHDRAWN, role: "member" });
    // 新しいオーナーは、オーナーの操作ができる
    expect((await api.call("u-first", "POST", `/trips/${trip.tripId}/invite`)).status).toBe(200);
  });

  it("メンバーが自分 1 人だけの旅は削除せずに残り、公開リンクも見られる", async () => {
    await api.signUp("u-leaver2", "ひとり旅");
    const trip = await api.createTrip("u-leaver2", { title: "ひとり旅" });
    await api.call("u-leaver2", "POST", `/trips/${trip.tripId}/items`, {
      day: 1,
      order: generateKeyBetween(null, null),
      title: "温泉",
    });
    const pub = (await api.call("u-leaver2", "POST", `/trips/${trip.tripId}/public`)).body.public
      .token;

    await api.call("u-leaver2", "DELETE", "/me");

    const res = await api.call(null, "GET", `/public/${pub}`);
    expect(res.status).toBe(200);
    expect(res.body.trip.title).toBe("ひとり旅");
    expect(res.body.members).toEqual([{ displayName: WITHDRAWN }]);
    expect(res.body.items).toHaveLength(1);
  });

  it("メンバーとして参加していた旅でも、名前が「退会した会員」になる", async () => {
    await api.signUp("u-host3", "主催");
    const trip = await api.createTrip("u-host3");
    await api.addMember(trip, "u-host3", "u-leaver3");

    await api.call("u-leaver3", "DELETE", "/me");

    const view = (await api.call("u-host3", "GET", `/trips/${trip.tripId}`)).body;
    expect(view.trip.ownerId).toBe("u-host3");
    expect(view.members.find((m: { userId: string }) => m.userId === "u-leaver3").displayName).toBe(
      WITHDRAWN,
    );
  });

  it("未処理の参加申請は消える", async () => {
    await api.signUp("u-host4", "主催");
    const trip = await api.createTrip("u-host4");
    await api.signUp("u-leaver4", "申請中の人");
    await api.call("u-leaver4", "POST", `/join/${trip.inviteToken}`);

    await api.call("u-leaver4", "DELETE", "/me");

    const list = await api.call("u-host4", "GET", `/trips/${trip.tripId}/join-requests`);
    expect(list.body.requests).toEqual([]);
    // 申請の件数も戻っている(上限の数え方がずれない)
    expect(await api.countRecords(trip.tripId, "JOINREQ#")).toBe(0);
  });

  it("退会した後は、プロフィールが見つからない(404)", async () => {
    await api.signUp("u-leaver5", "すぐ去る人");
    await api.call("u-leaver5", "DELETE", "/me");
    expect((await api.call("u-leaver5", "GET", "/me")).status).toBe(404);
  });

  it("表示名を登録していない人の退会も成功する", async () => {
    expect((await api.call("u-never-registered", "DELETE", "/me")).status).toBe(204);
  });
});
