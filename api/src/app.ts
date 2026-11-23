import { zValidator } from "@hono/zod-validator";
import {
  commentCreate,
  expenseCreate,
  ideaAdopt,
  ideaCreate,
  itemCreate,
  itemPatch,
  profileInput,
  transferInput,
  tripInput,
} from "@tritri/shared";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { secureHeaders } from "hono/secure-headers";
import type { ZodType } from "zod";
import type { AppEnv, Deps } from "./context.js";
import { isConflict } from "./db/errors.js";
import { withdraw } from "./repo/account.js";
import { createComment, deleteComment, deleteCommentsOfItem } from "./repo/comments.js";
import { createExpense, deleteExpense } from "./repo/expenses.js";
import { adoptIdea, createIdea, deleteIdea, unvote, vote } from "./repo/ideas.js";
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
import {
  deleteTrip,
  listRelatedTripIds,
  propagateDisplayName,
  removeMember,
  transferOwner,
  updateTrip,
} from "./repo/manage.js";
import { getProfile, putProfile } from "./repo/profiles.js";
import { getPublicView, replacePublicLink } from "./repo/public.js";
import {
  createTrip,
  getMember,
  getTripView,
  listMyPendingTrips,
  listMyTrips,
} from "./repo/trips.js";

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

  // 想定外の失敗も JSON で返し、内部の情報(例外の中身)は応答に出さない。
  // 同時の書き込みが続いて通らなかったときは、混み合っていると返す(画面は少し待ってやり直せる)
  app.onError((error, c) => {
    if (isConflict(error)) return c.json({ error: "BUSY" }, 503);
    console.error("API の処理に失敗しました", error);
    return c.json({ error: "INTERNAL" }, 500);
  });

  // URL の ID・トークンは長くても数十文字。極端に長いものは DB に問い合わせずに「見つからない」
  // (DynamoDB のキーの長さの上限を超えると、DB が失敗して 500 になるため)
  app.use("*", async (c, next) => {
    if (c.req.path.split("/").some((part) => part.length > 200)) return c.json(notFound, 404);
    await next();
  });

  app.use("*", secureHeaders());
  app.use(
    "*",
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) => c.json({ error: "PAYLOAD_TOO_LARGE" }, 413),
    }),
  );

  // ---- 公開しおり(ログイン不要。ログイン確認より前に登録する) ----
  // ここより前に置いた API は、test/security.test.ts の PUBLIC_ROUTES に載せること
  app.get("/public/:token", async (c) => {
    const view = await getPublicView(deps, c.req.param("token"));
    return view ? c.json(view) : c.json(notFound, 404);
  });

  // すべての API でログインを確かめる
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
    // 退会した人のメンバー情報は、支出などの記録のために残してある。旅は開けない
    if (!member || member.withdrawn) return c.json(notFound, 404);
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

  /**
   * 変更の通知。個々の API には書かない(test/notify.test.ts が全 API を確認)。
   * 通知の失敗で保存は失敗させない(画面は定期的な読み直しでも追いつく)。
   */
  async function notify(send: () => Promise<void>) {
    try {
      await send();
    } catch (error) {
      console.error("変更の通知に失敗しました", error);
    }
  }
  app.use("/trips/:tripId/*", async (c, next) => {
    const tripId = c.req.param("tripId");
    await next();
    if (!tripId || c.req.method === "GET" || !c.res.ok) return;
    if (c.req.path.endsWith("/ws-ticket")) return; // 旅の中身は変わらない
    await notify(() => deps.realtime.changed(tripId));
  });

  // ---- プロフィール ----
  app.get("/me", async (c) => {
    const profile = await getProfile(deps, c.get("userId"));
    return profile ? c.json(profile) : c.json(notFound, 404);
  });

  app.put("/me", validJson(profileInput), async (c) => {
    const profile = { userId: c.get("userId"), displayName: c.req.valid("json").displayName };
    await putProfile(deps, profile);
    await propagateDisplayName(deps, profile.userId, profile.displayName);
    await notify(async () => {
      const tripIds = await listRelatedTripIds(deps, profile.userId);
      await Promise.all(tripIds.map((id) => deps.realtime.changed(id)));
    });
    return c.json(profile);
  });

  app.delete("/me", async (c) => {
    const userId = c.get("userId");
    // 退会すると申請中の旅は引けなくなるので、先に控える
    const tripIds = await listRelatedTripIds(deps, userId);
    await withdraw(deps, userId);
    await notify(async () => {
      await Promise.all(tripIds.map((id) => deps.realtime.withdrawn(id, userId)));
    });
    return c.body(null, 204);
  });

  // ---- 旅 ----
  app.post("/trips", validJson(tripInput), async (c) => {
    const profile = await getProfile(deps, c.get("userId"));
    if (!profile) return c.json({ error: "PROFILE_REQUIRED" }, 409);
    return c.json(await createTrip(deps, profile, c.req.valid("json")), 201);
  });

  app.get("/trips", async (c) => {
    const userId = c.get("userId");
    const [trips, pending] = await Promise.all([
      listMyTrips(deps, userId),
      listMyPendingTrips(deps, userId),
    ]);
    return c.json({ trips, pending });
  });

  app.get("/trips/:tripId", async (c) => {
    const view = await getTripView(deps, c.req.param("tripId"), c.get("member"));
    return view ? c.json(view) : c.json(notFound, 404);
  });

  app.patch("/trips/:tripId", ownerOnly, validJson(tripInput), async (c) => {
    const result = await updateTrip(deps, c.req.param("tripId"), c.req.valid("json"));
    if ("trip" in result) return c.json(result);
    return result.error === "not_found"
      ? c.json(notFound, 404)
      : c.json({ error: "ITEMS_OUT_OF_RANGE" }, 409);
  });

  app.delete("/trips/:tripId", ownerOnly, async (c) => {
    const result = await deleteTrip(deps, c.req.param("tripId"), c.get("member"));
    return result === "deleted" ? c.body(null, 204) : c.json({ error: "CONFLICT" }, 409);
  });

  // ---- リアルタイム更新(WebSocket) ----
  app.post("/trips/:tripId/ws-ticket", async (c) => {
    const ticket = await deps.realtime.issueTicket(c.req.param("tripId"), c.get("userId"));
    return ticket ? c.json({ ticket }) : c.json({ error: "REALTIME_UNAVAILABLE" }, 503);
  });

  // ---- メンバーの管理 ----
  app.delete("/trips/:tripId/members/:userId", ownerOnly, async (c) => {
    const { tripId, userId } = c.req.param();
    if (userId === c.get("userId")) return c.json({ error: "CANNOT_REMOVE_SELF" }, 400);
    const result = await removeMember(deps, tripId, userId);
    return result === "removed" ? c.body(null, 204) : c.json(notFound, 404);
  });

  app.post("/trips/:tripId/leave", async (c) => {
    if (c.get("member").role === "owner") return c.json({ error: "OWNER_MUST_TRANSFER" }, 409);
    const tripId = c.req.param("tripId");
    if ((await removeMember(deps, tripId, c.get("userId"))) === "not_found") {
      // 同時にオーナーを引き継がれていた
      const now = await getMember(deps, tripId, c.get("userId"));
      if (now?.role === "owner") return c.json({ error: "OWNER_MUST_TRANSFER" }, 409);
    }
    return c.body(null, 204);
  });

  app.post("/trips/:tripId/transfer", ownerOnly, validJson(transferInput), async (c) => {
    const to = c.req.valid("json").userId;
    if (to === c.get("userId")) return c.json({ error: "CANNOT_TRANSFER_TO_SELF" }, 400);
    const result = await transferOwner(deps, c.req.param("tripId"), c.get("member"), to);
    if (result === "not_found") return c.json(notFound, 404);
    if (result === "conflict") return c.json({ error: "CONFLICT" }, 409);
    return c.body(null, 204);
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
    const member = await getMember(deps, tripId, userId);
    if (member && !member.withdrawn) return c.json({ error: "ALREADY_MEMBER" }, 409);
    const profile = await getProfile(deps, userId);
    if (!profile) return c.json({ error: "PROFILE_REQUIRED" }, 409);

    const result = await requestJoin(deps, tripId, profile);
    if (result === "full") return c.json({ error: "TOO_MANY_JOIN_REQUESTS" }, 409);
    if (result === "created") await notify(() => deps.realtime.changed(tripId));
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

  app.post("/trips/:tripId/public", ownerOnly, async (c) => {
    return c.json({ public: await replacePublicLink(deps, c.req.param("tripId"), "new") });
  });

  app.delete("/trips/:tripId/public", ownerOnly, async (c) => {
    await replacePublicLink(deps, c.req.param("tripId"), null);
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
    if ("deleted" in result) {
      await deleteCommentsOfItem(deps, tripId, itemId); // 後片付け: その予定のコメント
      return c.body(null, 204);
    }
    return result.error === "not_found"
      ? c.json(notFound, 404)
      : c.json({ error: "VERSION_CONFLICT", current: result.current }, 409);
  });

  // ---- コメント ----
  app.post("/trips/:tripId/items/:itemId/comments", validJson(commentCreate), async (c) => {
    const { tripId, itemId } = c.req.param();
    const result = await createComment(deps, tripId, itemId, c.get("member"), c.req.valid("json"));
    if ("comment" in result) return c.json(result, 201);
    if (result.error === "not_found") return c.json(notFound, 404);
    return result.error === "too_many_in_trip"
      ? c.json({ error: "TOO_MANY_TRIP_COMMENTS" }, 409)
      : c.json({ error: "TOO_MANY_COMMENTS" }, 409);
  });

  app.delete("/trips/:tripId/items/:itemId/comments/:commentId", async (c) => {
    const { tripId, itemId, commentId } = c.req.param();
    const result = await deleteComment(deps, tripId, itemId, commentId, c.get("member"));
    if (result === "not_found") return c.json(notFound, 404);
    if (result === "forbidden") return c.json({ error: "FORBIDDEN" }, 403);
    return c.body(null, 204);
  });

  // ---- 行きたい場所の候補 ----
  app.post("/trips/:tripId/ideas", validJson(ideaCreate), async (c) => {
    const result = await createIdea(
      deps,
      c.req.param("tripId"),
      c.get("userId"),
      c.req.valid("json"),
    );
    return "idea" in result ? c.json(result, 201) : c.json({ error: "TOO_MANY_IDEAS" }, 409);
  });

  app.delete("/trips/:tripId/ideas/:ideaId", async (c) => {
    const { tripId, ideaId } = c.req.param();
    const result = await deleteIdea(deps, tripId, ideaId, c.get("member"));
    if (result === "not_found") return c.json(notFound, 404);
    if (result === "forbidden") return c.json({ error: "FORBIDDEN" }, 403);
    return c.body(null, 204);
  });

  app.put("/trips/:tripId/ideas/:ideaId/vote", async (c) => {
    const { tripId, ideaId } = c.req.param();
    const result = await vote(deps, tripId, ideaId, c.get("userId"));
    return result === "ok" ? c.body(null, 204) : c.json(notFound, 404);
  });

  app.delete("/trips/:tripId/ideas/:ideaId/vote", async (c) => {
    const { tripId, ideaId } = c.req.param();
    await unvote(deps, tripId, ideaId, c.get("userId"));
    return c.body(null, 204);
  });

  app.post("/trips/:tripId/ideas/:ideaId/adopt", validJson(ideaAdopt), async (c) => {
    const { tripId, ideaId } = c.req.param();
    const result = await adoptIdea(deps, tripId, ideaId, c.get("userId"), c.req.valid("json"));
    if ("item" in result) return c.json(result, 201);
    switch (result.error) {
      case "not_found":
        return c.json(notFound, 404);
      case "day_out_of_range":
        return c.json({ error: "DAY_OUT_OF_RANGE" }, 400);
      case "too_many":
        return c.json({ error: "TOO_MANY_ITEMS" }, 409);
      case "already_adopted":
        return c.json({ error: "ALREADY_ADOPTED" }, 409);
    }
  });

  // ---- 割り勘 ----
  app.post("/trips/:tripId/expenses", validJson(expenseCreate), async (c) => {
    const result = await createExpense(
      deps,
      c.req.param("tripId"),
      c.get("userId"),
      c.req.valid("json"),
    );
    if ("expense" in result) return c.json(result, 201);
    return result.error === "not_a_member"
      ? c.json({ error: "NOT_A_MEMBER" }, 400)
      : c.json({ error: "TOO_MANY_EXPENSES" }, 409);
  });

  app.delete("/trips/:tripId/expenses/:expenseId", async (c) => {
    const { tripId, expenseId } = c.req.param();
    const result = await deleteExpense(deps, tripId, expenseId);
    return result === "deleted" ? c.body(null, 204) : c.json(notFound, 404);
  });

  app.notFound((c) => c.json(notFound, 404));
  return app;
}
