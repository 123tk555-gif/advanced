import { describe, expect, it } from "vitest";
import { googleRouteUrl, googleSearchUrl, legText, needsLookupLink } from "./map";

const kyoto = { label: "京都駅", placeId: "p-kyoto" };
const kiyomizu = { label: "清水|寺", placeId: "p-kiyo" };
const inari = { label: "お稲荷さん", placeId: "p-inari" };

describe("googleSearchUrl", () => {
  it("表示名と placeId で、その場所を開く", () => {
    const url = new URL(googleSearchUrl(kyoto));
    expect(url.searchParams.get("query")).toBe("京都駅");
    expect(url.searchParams.get("query_place_id")).toBe("p-kyoto");
  });
});

describe("googleRouteUrl", () => {
  it("場所が 2 つ未満なら null", () => {
    expect(googleRouteUrl([kyoto], "walk")).toBeNull();
  });

  it("出発地・到着地・経由地を、表示名と placeId で渡す(座標は使わない)", () => {
    const url = new URL(googleRouteUrl([kyoto, kiyomizu, inari], "transit") as string);
    expect(url.searchParams.get("origin")).toBe("京都駅");
    expect(url.searchParams.get("origin_place_id")).toBe("p-kyoto");
    expect(url.searchParams.get("destination")).toBe("お稲荷さん");
    expect(url.searchParams.get("destination_place_id")).toBe("p-inari");
    expect(url.searchParams.get("waypoint_place_ids")).toBe("p-kiyo");
    expect(url.searchParams.get("travelmode")).toBe("transit");
  });

  it("表示名の | は区切りと混ざらないよう空白にする", () => {
    const url = new URL(googleRouteUrl([kyoto, kiyomizu, inari], "car") as string);
    expect(url.searchParams.get("waypoints")).toBe("清水 寺");
  });
});

describe("区間の表示", () => {
  it("時間がわかれば時間を出す", () => {
    expect(legText({ status: "ok", value: { minutes: 12 } })).toBe("約 12 分");
    expect(legText({ status: "ok", value: { minutes: 75 } })).toBe("約 1 時間 15 分");
    expect(legText({ status: "loading" })).toBe("計算中…");
  });

  it("経路が無い・取得に失敗したときは、目安の数字を出さない", () => {
    expect(legText({ status: "none" })).toBe("時間はここでは出せません");
    expect(legText({ status: "failed" })).toBe("時間を取得できませんでした");
  });

  it("時間を出せない区間だけ「Google マップで調べる」リンクを出す", () => {
    expect(needsLookupLink({ status: "none" })).toBe(true);
    expect(needsLookupLink({ status: "failed" })).toBe(true);
    expect(needsLookupLink({ status: "loading" })).toBe(false);
    expect(needsLookupLink({ status: "ok", value: { minutes: 3 } })).toBe(false);
  });
});
