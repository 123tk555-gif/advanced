import { generateKeyBetween } from "fractional-indexing";
import { beforeAll, describe, expect, it } from "vitest";
import { useTestApi } from "./helpers.js";

const api = useTestApi();

beforeAll(async () => {
  await api.signUp("u-owner", "オーナー");
});

/** 予定 1 件・メンバー 2 人の旅を作る */
async function tripWithItem() {
  const trip = await api.createTrip("u-owner", { title: "公開テスト" });
  await api.addMember(trip, "u-owner", `u-pub${Math.random().toString(36).slice(2, 8)}`);
  await api.call("u-owner", "POST", `/trips/${trip.tripId}/items`, {
    day: 1,
    order: generateKeyBetween(null, null),
    title: "清水寺",
    place: { name: "清水寺", lat: 34.9949, lng: 135.785 },
    memo: "朝いち",
  });
  return trip;
}

async function publish(tripId: string) {
  const res = await api.call("u-owner", "POST", `/trips/${tripId}/public`);
  expect(res.status).toBe(200);
  return res.body.public.token as string;
}

describe("公開しおり", () => {
  it("ログインしなくても、旅程とメンバーの表示名を見られる", async () => {
    const trip = await tripWithItem();
    const token = await publish(trip.tripId);

    const res = await api.call(null, "GET", `/public/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.trip).toEqual({
      title: "公開テスト",
      startDate: "2027-04-01",
      endDate: "2027-04-03",
      destination: "京都",
    });
    expect(res.body.members).toEqual([
      { displayName: "オーナー" },
      { displayName: expect.any(String) },
    ]);
    expect(res.body.items).toEqual([
      {
        itemId: expect.any(String),
        day: 1,
        order: expect.any(String),
        time: "",
        title: "清水寺",
        place: { name: "清水寺", lat: 34.9949, lng: 135.785 },
        memo: "朝いち",
      },
    ]);
  });

  it("利用者の ID・招待リンク・割り勘・コメント・候補は返さない", async () => {
    const trip = await tripWithItem();
    const token = await publish(trip.tripId);
    const text = JSON.stringify((await api.call(null, "GET", `/public/${token}`)).body);
    for (const word of [
      "userId",
      "ownerId",
      "updatedBy",
      "invite",
      "expenses",
      "comments",
      "ideas",
      "u-owner",
    ]) {
      expect(text, word).not.toContain(word);
    }
  });

  it("メンバーは旅の画面で公開リンクを見られる。公開していなければ null", async () => {
    const trip = await tripWithItem();
    const before = await api.call("u-owner", "GET", `/trips/${trip.tripId}`);
    expect(before.body.public).toBeNull();
    const token = await publish(trip.tripId);
    const after = await api.call("u-owner", "GET", `/trips/${trip.tripId}`);
    expect(after.body.public).toEqual({ token });
  });

  it("止めたリンク・発行し直す前のリンクは、存在しないリンクと同じ 404", async () => {
    const trip = await tripWithItem();
    const first = await publish(trip.tripId);
    const second = await publish(trip.tripId); // 発行し直し
    expect(second).not.toBe(first);

    const unknown = await api.call(null, "GET", "/public/unknown-token");
    const old = await api.call(null, "GET", `/public/${first}`);
    expect(old.status).toBe(404);
    expect(old.body).toEqual(unknown.body);
    expect((await api.call(null, "GET", `/public/${second}`)).status).toBe(200);

    expect((await api.call("u-owner", "DELETE", `/trips/${trip.tripId}/public`)).status).toBe(204);
    expect((await api.call(null, "GET", `/public/${second}`)).status).toBe(404);
    expect((await api.call("u-owner", "GET", `/trips/${trip.tripId}`)).body.public).toBeNull();
  });

  it("公開リンクの発行・停止はオーナーだけ(メンバーは 403)", async () => {
    const trip = await api.createTrip("u-owner");
    await api.addMember(trip, "u-owner", "u-pubmember");
    expect((await api.call("u-pubmember", "POST", `/trips/${trip.tripId}/public`)).status).toBe(
      403,
    );
    expect((await api.call("u-pubmember", "DELETE", `/trips/${trip.tripId}/public`)).status).toBe(
      403,
    );
  });
});
