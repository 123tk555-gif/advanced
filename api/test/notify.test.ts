import { beforeEach, describe, expect, it } from "vitest";
import { useTestApi, validTrip } from "./helpers.js";

/**
 * 通知漏れの棚卸し。
 * 変更する API を足したら、下の表にも足さないと失敗する。表にある API は、実際に呼んで通知を確かめる。
 */
const api = useTestApi();

/** 変更しても、どの旅の画面にも知らせなくてよい API */
const NO_NOTIFY = [
  "POST /trips", // 新しい旅。まだ誰も見ていない
  "POST /trips/:tripId/ws-ticket", // 旅の中身は変わらない
];

interface Ctx {
  owner: string;
  friend: string;
  applicant: string;
  base: string;
  inviteToken: string;
  itemId: string;
  ideaId: string;
}
type Call = [user: string, method: string, path: string, body?: unknown];
interface Scenario {
  /** 先にしておく操作 */
  before?: (x: Ctx) => Call;
  run: (x: Ctx) => Call;
  /** before の応答の ID を URL の末尾に付ける(作ったものを消す API) */
  idFrom?: "comment.commentId" | "expense.expenseId";
}

const applied = (x: Ctx): Call => [x.applicant, "POST", `/join/${x.inviteToken}`];
const comment = (x: Ctx): Call => [
  x.friend,
  "POST",
  `${x.base}/items/${x.itemId}/comments`,
  { body: "楽しみ" },
];
const expense = (x: Ctx): Call => [
  x.friend,
  "POST",
  `${x.base}/expenses`,
  { title: "昼ごはん", amount: 1000, paidBy: x.friend, splitWith: [x.owner, x.friend] },
];
const voted = (x: Ctx): Call => [x.friend, "PUT", `${x.base}/ideas/${x.ideaId}/vote`];

const SCENARIOS: Record<string, Scenario> = {
  "PUT /me": { run: (x) => [x.friend, "PUT", "/me", { displayName: "新しい名前" }] },
  "DELETE /me": { run: (x) => [x.friend, "DELETE", "/me"] },
  "POST /join/:token": { run: applied },
  "PATCH /trips/:tripId": {
    run: (x) => [x.owner, "PATCH", x.base, { ...validTrip, title: "変更" }],
  },
  "DELETE /trips/:tripId": { run: (x) => [x.owner, "DELETE", x.base] },
  "DELETE /trips/:tripId/members/:userId": {
    run: (x) => [x.owner, "DELETE", `${x.base}/members/${x.friend}`],
  },
  "POST /trips/:tripId/leave": { run: (x) => [x.friend, "POST", `${x.base}/leave`] },
  "POST /trips/:tripId/transfer": {
    run: (x) => [x.owner, "POST", `${x.base}/transfer`, { userId: x.friend }],
  },
  "POST /trips/:tripId/join-requests/:userId/approve": {
    before: applied,
    run: (x) => [x.owner, "POST", `${x.base}/join-requests/${x.applicant}/approve`],
  },
  "POST /trips/:tripId/join-requests/:userId/reject": {
    before: applied,
    run: (x) => [x.owner, "POST", `${x.base}/join-requests/${x.applicant}/reject`],
  },
  "POST /trips/:tripId/invite": { run: (x) => [x.owner, "POST", `${x.base}/invite`] },
  "DELETE /trips/:tripId/invite": { run: (x) => [x.owner, "DELETE", `${x.base}/invite`] },
  "POST /trips/:tripId/public": { run: (x) => [x.owner, "POST", `${x.base}/public`] },
  "DELETE /trips/:tripId/public": { run: (x) => [x.owner, "DELETE", `${x.base}/public`] },
  "POST /trips/:tripId/items": {
    run: (x) => [x.friend, "POST", `${x.base}/items`, { day: 1, order: "a1", title: "追加" }],
  },
  "PATCH /trips/:tripId/items/:itemId": {
    run: (x) => [x.friend, "PATCH", `${x.base}/items/${x.itemId}`, { version: 1, title: "変更" }],
  },
  "DELETE /trips/:tripId/items/:itemId": {
    run: (x) => [x.friend, "DELETE", `${x.base}/items/${x.itemId}?version=1`],
  },
  "POST /trips/:tripId/items/:itemId/comments": { run: comment },
  "DELETE /trips/:tripId/items/:itemId/comments/:commentId": {
    before: comment,
    idFrom: "comment.commentId",
    run: (x) => [x.friend, "DELETE", `${x.base}/items/${x.itemId}/comments`],
  },
  "POST /trips/:tripId/ideas": {
    run: (x) => [x.friend, "POST", `${x.base}/ideas`, { name: "金閣寺" }],
  },
  "DELETE /trips/:tripId/ideas/:ideaId": {
    run: (x) => [x.owner, "DELETE", `${x.base}/ideas/${x.ideaId}`],
  },
  "PUT /trips/:tripId/ideas/:ideaId/vote": { run: voted },
  "DELETE /trips/:tripId/ideas/:ideaId/vote": {
    before: voted,
    run: (x) => [x.friend, "DELETE", `${x.base}/ideas/${x.ideaId}/vote`],
  },
  "POST /trips/:tripId/ideas/:ideaId/adopt": {
    run: (x) => [x.friend, "POST", `${x.base}/ideas/${x.ideaId}/adopt`, { day: 1, order: "a1" }],
  },
  "POST /trips/:tripId/expenses": { run: expense },
  "DELETE /trips/:tripId/expenses/:expenseId": {
    before: expense,
    idFrom: "expense.expenseId",
    run: (x) => [x.friend, "DELETE", `${x.base}/expenses`],
  },
};

let n = 0;
let ctx: Ctx;
let watcher = "";

beforeEach(async () => {
  n += 1;
  const owner = `owner${n}`;
  const friend = `friend${n}`;
  const applicant = `applicant${n}`;
  await api.signUp(owner);
  await api.signUp(applicant);
  const trip = await api.createTrip(owner);
  await api.addMember(trip, owner, friend);
  const base = `/trips/${trip.tripId}`;
  const item = await api.call(owner, "POST", `${base}/items`, { day: 1, order: "a0", title: "朝" });
  const idea = await api.call(owner, "POST", `${base}/ideas`, { name: "平等院" });
  ctx = {
    owner,
    friend,
    applicant,
    base,
    inviteToken: trip.inviteToken,
    itemId: item.body.item.itemId,
    ideaId: idea.body.idea.ideaId,
  };

  watcher = `watcher${n}`;
  const ticket = await api.call(owner, "POST", `${base}/ws-ticket`);
  expect(await api.realtime.connect(watcher, ticket.body.ticket)).toBe(true);
});

describe("通知漏れの棚卸し", () => {
  it("変更する API が、すべて表に載っている", () => {
    const mutating = api.app.routes
      .filter((r) => r.method !== "ALL" && r.method !== "GET")
      .map((r) => `${r.method} ${r.path}`);
    const expected = [...Object.keys(SCENARIOS), ...NO_NOTIFY].sort();
    expect([...new Set(mutating)].sort()).toEqual(expected);
  });

  it.each(Object.entries(SCENARIOS))("%s は 1 回だけ通知する", async (_name, scenario) => {
    let suffix = "";
    if (scenario.before) {
      const res = await api.call(...scenario.before(ctx));
      expect(res.status).toBeLessThan(300);
      const [group, key] = scenario.idFrom?.split(".") ?? [];
      if (group && key) suffix = `/${res.body[group][key]}`;
    }
    api.outbox.clear();
    const [user, method, path, body] = scenario.run(ctx);
    expect((await api.call(user, method, `${path}${suffix}`, body)).status).toBeLessThan(300);
    const signals = api.outbox.types(watcher).filter((t) => t === "changed" || t === "revoked");
    expect(signals).toHaveLength(1);
  });

  it("読むだけ・失敗した操作では通知しない", async () => {
    api.outbox.clear();
    await api.call(ctx.owner, "GET", ctx.base);
    await api.call(ctx.owner, "POST", `${ctx.base}/items`, { title: "" });
    await api.call(ctx.friend, "DELETE", ctx.base);
    expect(api.outbox.of(watcher)).toEqual([]);
  });
});
