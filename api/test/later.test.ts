import { describe, expect, it } from "vitest";
import { useTestApi } from "./helpers.js";

/** 旅の削除は、開けなくする所までで応答し、残りの後片付けは後で行う */
const tasks: (() => Promise<void>)[] = [];
const api = useTestApi({
  later: async (task) => {
    tasks.push(task);
  },
});

describe("旅の削除の後片付け", () => {
  it("応答の時点で旅は開けず、後片付けが終わると項目も残らない", async () => {
    await api.signUp("owner");
    const trip = await api.createTrip("owner");
    const base = `/trips/${trip.tripId}`;
    await api.call("owner", "POST", `${base}/items`, { day: 1, order: "a0", title: "x" });

    expect((await api.call("owner", "DELETE", base)).status).toBe(204);
    expect((await api.call("owner", "GET", base)).status).toBe(404);
    expect((await api.call("owner", "GET", "/trips")).body.trips).toEqual([]);
    expect(tasks).toHaveLength(1);
    expect(await api.countRecords(trip.tripId, "")).toBeGreaterThan(0);

    await tasks[0]?.();
    expect(await api.countRecords(trip.tripId, "")).toBe(0);
  });
});
