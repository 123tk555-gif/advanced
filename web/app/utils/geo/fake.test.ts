import { describe, expect, it } from "vitest";
import { fakePlaces, fakeRoutes, legMinutes } from "./fake";

describe("仮の場所検索(API キーがないとき)", () => {
  it("名前の一部で候補が出て、選ぶと ID と位置がわかる", async () => {
    const found = await fakePlaces.suggest("伏見");
    expect(found.map((x) => x.main)).toEqual(["伏見稲荷大社"]);
    expect(await fakePlaces.resolve(found[0] as (typeof found)[number])).toEqual({
      placeId: "fake:伏見稲荷大社",
      position: { lat: 34.9671, lng: 135.7727 },
    });
  });

  it("保存した ID から位置を引ける。知らない ID は null", async () => {
    expect(await fakePlaces.locate("fake:京都駅")).toEqual({ lat: 34.9858, lng: 135.7588 });
    expect(await fakePlaces.locate("unknown")).toBeNull();
  });

  it("候補は 8 件まで", async () => {
    expect((await fakePlaces.suggest("寺")).length).toBeLessThanOrEqual(8);
  });
});

describe("仮の経路", () => {
  const a = { label: "駅", placeId: "fake:京都駅" };
  const b = { label: "稲荷", placeId: "fake:伏見稲荷大社" };
  const from = { lat: 34.9858, lng: 135.7588 };
  const to = { lat: 34.9671, lng: 135.7727 };

  it("徒歩と車は直線距離からの目安。徒歩の方が長い", async () => {
    expect(legMinutes(from, to, "walk")).toBeGreaterThan(legMinutes(from, to, "car"));
    expect(await fakeRoutes.leg(a, b, "walk")).toEqual({ minutes: legMinutes(from, to, "walk") });
  });

  it("公共交通は時間を作らない(日本の Google と同じく「経路なし」)", async () => {
    expect(await fakeRoutes.leg(a, b, "transit")).toBeNull();
  });
});
