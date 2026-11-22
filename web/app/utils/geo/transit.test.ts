import { describe, expect, it } from "vitest";
import { mergeSuggestions, transitKind } from "./transit";

describe("transitKind(候補に付ける種類の文字)", () => {
  // 型の並びは 2026-11-22 に Google が実際に返したもの
  it.each([
    ["京都駅", ["train_station", "subway_station", "transit_station"], "駅"],
    ["新宿駅", ["transit_station", "transportation_service"], "駅"],
    ["四条河原町", ["transit_station", "transit_stop", "bus_stop"], "バス停"],
    ["那覇空港国内線ターミナル", ["bus_station", "transit_station"], "バス停"],
    ["嵐山駅", ["transit_stop", "transit_station", "tram_stop"], "路面電車"],
    ["宮島桟橋", ["ferry_terminal", "transit_station"], "港"],
    ["那覇空港", ["airport", "international_airport"], "空港"],
    ["那覇新港", ["transit_station", "transportation_service"], "乗り場"],
  ])("%s → %s", (name, types, kind) => {
    expect(transitKind(name, types)).toBe(kind);
  });

  it("交通機関でなければ付けない(名前が「駅」で終わる店なども)", () => {
    expect(transitKind("清水寺", ["buddhist_temple"])).toBeUndefined();
    expect(transitKind("道の駅", ["store"])).toBeUndefined();
  });
});

describe("mergeSuggestions", () => {
  const s = (id: string) => ({ id, main: id });

  it("ふつうの候補の順を保ち、重ならない駅・バス停を後ろに足す", () => {
    const merged = mergeSuggestions([s("寺"), s("駅")], [s("駅"), s("バス停")]);
    expect(merged.map((x) => x.id)).toEqual(["寺", "駅", "バス停"]);
  });
});
