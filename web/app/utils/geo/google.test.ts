import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGooglePlaces } from "./google";

const { fetchSuggestions } = vi.hoisted(() => ({ fetchSuggestions: vi.fn() }));
vi.mock("@googlemaps/js-api-loader", () => ({
  setOptions: () => {},
  importLibrary: async () => ({
    AutocompleteSessionToken: class {},
    AutocompleteSuggestion: { fetchAutocompleteSuggestions: fetchSuggestions },
  }),
}));

const found = (placeId: string, types: string[]) => ({
  placePrediction: {
    placeId,
    types,
    mainText: { text: placeId },
    text: { text: placeId },
    toPlace: () => ({
      id: placeId,
      location: { lat: () => 35, lng: () => 135 },
      fetchFields: async () => {},
    }),
  },
});
type Request = { includedPrimaryTypes?: string[]; sessionToken: object; locationBias?: object };
const answer = (general: () => unknown, transit: () => unknown) =>
  fetchSuggestions.mockImplementation(async (request: Request) => ({
    suggestions: request.includedPrimaryTypes ? transit() : general(),
  }));
const fail = () => {
  throw new Error("quota");
};

beforeEach(() => {
  fetchSuggestions.mockReset();
});

describe("Google の候補検索", () => {
  it("ふつうの検索と駅・バス停の検索を、同じセッションで合わせて出す", async () => {
    answer(
      () => [found("寺", ["buddhist_temple"])],
      () => [found("停", ["bus_stop"])],
    );
    expect(await createGooglePlaces().suggest("清水")).toEqual([
      { id: "寺", main: "寺" },
      { id: "停", main: "停", kind: "バス停" },
    ]);
    const [a, b] = fetchSuggestions.mock.calls.map(([request]) => request as Request);
    expect(a?.sessionToken).toBe(b?.sessionToken);
    expect(a?.includedPrimaryTypes).toBeUndefined();
    // Google が受け付ける種類は 5 つまで
    expect(b?.includedPrimaryTypes?.length).toBeLessThanOrEqual(5);
    expect(b?.includedPrimaryTypes).toEqual(expect.arrayContaining(["transit_station", "airport"]));
  });

  it("基準の位置があれば、どちらの検索も近くを優先する(遠くも除かない)", async () => {
    answer(
      () => [],
      () => [],
    );
    const near = { lat: 34.98, lng: 135.75 };
    await createGooglePlaces().suggest("四条", near);
    for (const [request] of fetchSuggestions.mock.calls) {
      expect(request.locationBias).toEqual({ center: near, radius: 50_000 });
      expect(request.locationRestriction).toBeUndefined();
    }
  });

  it("片方が失敗しても、もう片方の候補は出す", async () => {
    answer(() => [found("寺", [])], fail);
    expect(await createGooglePlaces().suggest("清水")).toHaveLength(1);
    answer(fail, () => [found("停", ["bus_stop"])]);
    expect(await createGooglePlaces().suggest("清水")).toHaveLength(1);
  });

  it("両方失敗したら失敗にする", async () => {
    answer(fail, fail);
    await expect(createGooglePlaces().suggest("清水")).rejects.toThrow("quota");
  });

  it("駅・バス停の検索から出た候補も選べる", async () => {
    answer(
      () => [],
      () => [found("停", ["bus_stop"])],
    );
    const places = createGooglePlaces();
    const [stop] = await places.suggest("清水");
    expect(await places.resolve(stop as NonNullable<typeof stop>)).toEqual({
      placeId: "停",
      position: { lat: 35, lng: 135 },
    });
  });
});
