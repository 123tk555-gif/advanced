import { zValidator } from "@hono/zod-validator";
import { itemCreate, itemPatch, profileInput, tripInput } from "@tritri/shared";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { secureHeaders } from "hono/secure-headers";
import type { ZodType } from "zod";
import type { AppEnv, Deps } from "./context.js";
import {
  approveJoin,
  findTripIdByInvite,
  getJoinInfo,
  listJoinRequests,
  rejectJoin,
  replaceInvite,
  requestJoin,
} from "./repo/invites.js";
import { createItem, deleteItem, type Item, updateItem } from "./repo/items.js";
import { getProfile, putProfile } from "./repo/profiles.js";
import { createTrip, getMember, getTripView, listMyTrips } from "./repo/trips.js";

/** 入力の検証。失敗したら 400 と、どの項目がなぜ駄目かを返す */
const validJson = <T extends ZodType>(schema: T) =>
  zValidator("json", schema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: "VALIDATION",
          issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        400,
      );
    }
  });

/** 「無い」と「見せられない」を区別しない、共通の 404 */
const notFound = { error: "NOT_FOUND" } as const;

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.use("*", secureHeaders());
  app.use(
    "*",
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) => c.json({ error: "PAYLOAD_TOO_LARGE" }, 413),
    }),
  );

  // すべての API でログインを確かめる(公開しおりの API を足すときは、これより前に置く)
  app.use("*", async (c, next) => {
    const userId = deps.resolveUserId(c);
    if (!userId) return c.json({ error: "UNAUTHORIZED" }, 401);
    c.set("userId", userId);
    await next();
  });

  /**
   * `/trips/:tripId` 以下の全 API に共通の確認。メンバーでなければ、旅が無いときと同じ 404。
   * 個々の API に書くと書き忘れるので、ここで一括して行う(test/security.test.ts で全 API を確認)。
   */
  const memberOnly = createMiddleware<AppEnv>(async (c, next) => {
    const tripId = c.req.param("tripId");
    const member = tripId ? await getMember(deps, tripId, c.get("userId")) : undefined;
    if (!member) return c.json(notFound, 404);
    c.set("member", member);
    await next();
  });
  app.use("/trips/:tripId", memberOnly);
  app.use("/trips/:tripId/*", memberOnly);

  /** オーナー専用の操作。メンバーであることは memberOnly が確かめ済み */
  const ownerOnly = createMiddleware<AppEnv>(async (c, next) => {
    if (c.get("member").role !== "owner") return c.json({ error: "FORBIDDEN" }, 403);
    await next();
  });

  // ---- プロフィール ----
  app.get("/me", async (c) => {
    const profile = await getProfile(deps, c.get("userId"));
    return profile ? c.json(profile) : c.json(notFound, 404);
  });

  app.put("/me", validJson(profileInput), async (c) => {
    const profile = { userId: c.get("userId"), displayName: c.req.valid("json").displayName };
    await putProfile(deps, profile);
    return c.json(profile);
  });

  // ---- 旅 ----
  app.post("/trips", validJson(tripInput), async (c) => {
    const profile = await getProfile(deps, c.get("userId"));
    if (!profile) return c.json({ error: "PROFILE_REQUIRED" }, 409);
    return c.json(await createTrip(deps, profile, c.req.valid("json")), 201);
  });

  app.get("/trips", async (c) => {
    return c.json({ trips: await listMyTrips(deps, c.get("userId")) });
  });

  app.get("/trips/:tripId", async (c) => {
    const view = await getTripView(deps, c.req.param("tripId"), c.get("member"));
    return view ? c.json(view) : c.json(notFound, 404);
  });

  // ---- 招待リンクと参加申請 ----
  app.get("/join/:token", async (c) => {
    const tripId = await findTripIdByInvite(deps, c.req.param("token"));
    const info = tripId ? await getJoinInfo(deps, tripId, c.get("userId")) : undefined;
    return info ? c.json(info) : c.json(notFound, 404);
  });

  app.post("/join/:token", async (c) => {
    const tripId = await findTripIdByInvite(deps, c.req.param("token"));
    if (!tripId) return c.json(notFound, 404);
    const userId = c.get("userId");
    if (await getMember(deps, tripId, userId)) return c.json({ error: "ALREADY_MEMBER" }, 409);
    const profile = await getProfile(deps, userId);
    if (!profile) return c.json({ error: "PROFILE_REQUIRED" }, 409);

    const result = await requestJoin(deps, tripId, profile);
    if (result === "full") return c.json({ error: "TOO_MANY_JOIN_REQUESTS" }, 409);
    return c.json({ status: "pending" }, result === "created" ? 201 : 200);
  });

  app.get("/trips/:tripId/join-requests", ownerOnly, async (c) => {
    return c.json({ requests: await listJoinRequests(deps, c.req.param("tripId")) });
  });

  app.post("/trips/:tripId/join-requests/:userId/approve", ownerOnly, async (c) => {
    const result = await approveJoin(deps, c.req.param("tripId"), c.req.param("userId"));
    if (result === "not_found") return c.json(notFound, 404);
    if (result === "full") return c.json({ error: "TRIP_FULL" }, 409);
    return c.json({ status: "approved" });
  });

  app.post("/trips/:tripId/join-requests/:userId/reject", ownerOnly, async (c) => {
    const result = await rejectJoin(deps, c.req.param("tripId"), c.req.param("userId"));
    return result === "not_found" ? c.json(notFound, 404) : c.body(null, 204);
  });

  app.post("/trips/:tripId/invite", ownerOnly, async (c) => {
    return c.json({ invite: await replaceInvite(deps, c.req.param("tripId"), "new") });
  });

  app.delete("/trips/:tripId/invite", ownerOnly, async (c) => {
    await replaceInvite(deps, c.req.param("tripId"), null);
    return c.body(null, 204);
  });

  // ---- しおりの予定 ----
  const itemResult = (
    c: Context<AppEnv>,
    result:
      | { item: Item }
      | { error: "not_found" | "day_out_of_range" | "too_many" }
      | { error: "conflict"; current: Item },
    okStatus: 200 | 201,
  ) => {
    if ("item" in result) return c.json({ item: result.item }, okStatus);
    switch (result.error) {
      case "not_found":
        return c.json(notFound, 404);
      case "day_out_of_range":
        return c.json({ error: "DAY_OUT_OF_RANGE" }, 400);
      case "too_many":
        return c.json({ error: "TOO_MANY_ITEMS" }, 409);
      case "conflict":
        return c.json({ error: "VERSION_CONFLICT", current: result.current }, 409);
    }
  };

  app.post("/trips/:tripId/items", validJson(itemCreate), async (c) => {
    const result = await createItem(
      deps,
      c.req.param("tripId"),
      c.get("userId"),
      c.req.valid("json"),
    );
    return itemResult(c, result, 201);
  });

  app.patch("/trips/:tripId/items/:itemId", validJson(itemPatch), async (c) => {
    const { tripId, itemId } = c.req.param();
    const result = await updateItem(deps, tripId, itemId, c.get("userId"), c.req.valid("json"));
    return itemResult(c, result, 200);
  });

  app.delete("/trips/:tripId/items/:itemId", async (c) => {
    const version = c.req.query("version") ?? "";
    if (!/^[1-9]\d{0,8}$/.test(version)) {
      return c.json({ error: "VALIDATION", issues: [{ path: "version", message: "必須" }] }, 400);
    }
    const { tripId, itemId } = c.req.param();
    const result = await deleteItem(deps, tripId, itemId, Number(version));
    if ("deleted" in result) return c.body(null, 204);
    return result.error === "not_found"
      ? c.json(notFound, 404)
      : c.json({ error: "VERSION_CONFLICT", current: result.current }, 409);
  });

  app.notFound((c) => c.json(notFound, 404));
  return app;
}
