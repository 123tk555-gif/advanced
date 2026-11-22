import { describe, expect, it, vi } from "vitest";
import { createLegStore, legKey } from "./legs";

const kyoto = { label: "京都駅", placeId: "p-kyoto" };
const inari = { label: "お稲荷さん", placeId: "p-inari" };

describe("legKey", () => {
  it("移動手段・出発地・到着地の ID で決まる", () => {
    expect(legKey(kyoto, inari, "walk")).not.toBe(legKey(kyoto, inari, "car"));
    expect(legKey(kyoto, inari, "walk")).not.toBe(legKey(inari, kyoto, "walk"));
  });

  it("表示名だけを変えても同じ区間(問い合わせ直さない)", () => {
    expect(legKey(kyoto, inari, "walk")).toBe(
      legKey({ ...kyoto, label: "集合場所" }, inari, "walk"),
    );
  });
});

describe("createLegStore", () => {
  it("区間の時間と線を返し、同じ区間は 1 回だけ問い合わせる", async () => {
    const path = [
      { lat: 34.98, lng: 135.75 },
      { lat: 34.97, lng: 135.77 },
    ];
    const service = { leg: vi.fn(async () => ({ minutes: 9, path })) };
    const notify = vi.fn();
    const store = createLegStore(service, notify);
    expect(store.get(kyoto, inari, "car")).toEqual({ status: "loading" });
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    expect(store.get(kyoto, inari, "car")).toEqual({ status: "ok", value: { minutes: 9, path } });
    expect(service.leg).toHaveBeenCalledTimes(1);
    expect(service.leg).toHaveBeenCalledWith(kyoto, inari, "car");
  });
});
