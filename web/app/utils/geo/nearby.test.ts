import { describe, expect, it } from "vitest";
import { referencePlaceId } from "./nearby";

const at = (day: number, placeId: string | null) => ({
  day,
  place: placeId ? { placeId, label: placeId } : null,
});

describe("referencePlaceId(近くを優先する基準の場所)", () => {
  it("その日の、場所のある最後の予定", () => {
    expect(referencePlaceId([at(1, "a"), at(2, "b"), at(2, "c"), at(2, null)], 2)).toBe("c");
  });

  it("その日に無ければ、前の日のいちばん近いもの(前泊の場所など)", () => {
    expect(referencePlaceId([at(1, "a"), at(1, "b"), at(4, "c")], 3)).toBe("b");
  });

  it("前の日にも無ければ、後の日のいちばん近いもの", () => {
    expect(referencePlaceId([at(3, "a"), at(3, "b"), at(5, "c")], 1)).toBe("a");
  });

  it("場所のある予定が無ければ undefined", () => {
    expect(referencePlaceId([at(1, null)], 1)).toBeUndefined();
  });
});
