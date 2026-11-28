// L1 基準: 1 人ずつ順に、全 API を通しで呼ぶ(1 分)
import { check, sleep } from "k6";
import exec from "k6/execution";
import { appErrors, call, summary, TREND_STATS } from "./lib.js";

export const options = {
  scenarios: { baseline: { executor: "constant-vus", vus: 1, duration: __ENV.DURATION || "60s" } },
  thresholds: { app_errors: ["rate==0"], checks: ["rate==1"] },
  summaryTrendStats: TREND_STATS,
};

function must(result, status, what) {
  const ok = check(result, { [what]: (r) => r.status === status });
  if (!ok) appErrors.add(true);
  return result.data;
}

export default function () {
  const n = `${exec.vu.iterationInScenario}x${Date.now()}`;
  const owner = `l1o${n}`;
  const guest = `l1g${n}`;
  const other = `l1r${n}`;
  for (const user of [owner, guest, other]) {
    must(call(user, "PUT", "/me", { displayName: "基準" }, "/me"), 200, "PUT /me");
  }
  must(call(owner, "GET", "/me", undefined, "/me"), 200, "GET /me");

  const input = { title: "基準の旅", startDate: "2027-04-01", endDate: "2027-04-03" };
  const made = must(call(owner, "POST", "/trips", input, "/trips"), 201, "POST /trips");
  if (!made) return;
  const t = `/trips/${made.trip.tripId}`;
  const join = `/join/${made.invite.token}`;

  const run = (user, method, path, body, route, status) =>
    must(call(user, method, path, body, route), status, `${method} ${route}`);

  run(owner, "GET", "/trips", undefined, "/trips", 200);
  run(owner, "GET", t, undefined, "/trips/:id", 200);
  run(owner, "PATCH", t, Object.assign({}, input, { title: "変更" }), "/trips/:id", 200);
  run(owner, "POST", `${t}/ws-ticket`, undefined, "/trips/:id/ws-ticket", 200);

  run(guest, "GET", join, undefined, "/join/:token", 200);
  run(guest, "POST", join, undefined, "/join/:token", 201);
  run(other, "POST", join, undefined, "/join/:token", 201);
  run(owner, "GET", `${t}/join-requests`, undefined, "/trips/:id/join-requests", 200);
  run(owner, "POST", `${t}/join-requests/${guest}/approve`, undefined, "/approve", 200);
  run(owner, "POST", `${t}/join-requests/${other}/reject`, undefined, "/reject", 204);

  const made1 = run(
    guest,
    "POST",
    `${t}/items`,
    { day: 1, order: "a0", title: "朝" },
    "/items",
    201,
  );
  const item = `${t}/items/${made1.item.itemId}`;
  run(guest, "PATCH", item, { version: 1, title: "朝食" }, "/items/:id", 200);
  const made2 = run(guest, "POST", `${item}/comments`, { body: "楽しみ" }, "/comments", 201);
  const comment = `${item}/comments/${made2.comment.commentId}`;
  run(guest, "DELETE", comment, undefined, "/comments/:id", 204);

  const made3 = run(guest, "POST", `${t}/ideas`, { name: "平等院" }, "/ideas", 201);
  const idea = `${t}/ideas/${made3.idea.ideaId}`;
  run(guest, "PUT", `${idea}/vote`, undefined, "/vote", 204);
  run(guest, "DELETE", `${idea}/vote`, undefined, "/vote", 204);
  run(guest, "POST", `${idea}/adopt`, { day: 1, order: "a1" }, "/adopt", 201);
  run(guest, "DELETE", idea, undefined, "/ideas/:id", 204);

  const paid = { title: "昼", amount: 1000, paidBy: guest, splitWith: [owner, guest] };
  const made4 = run(guest, "POST", `${t}/expenses`, paid, "/expenses", 201);
  run(guest, "DELETE", `${t}/expenses/${made4.expense.expenseId}`, undefined, "/expenses/:id", 204);

  const pub = run(owner, "POST", `${t}/public`, undefined, "/public", 200);
  run(null, "GET", `/public/${pub.public.token}`, undefined, "/public/:token", 200);
  run(owner, "DELETE", `${t}/public`, undefined, "/public", 204);
  run(owner, "POST", `${t}/invite`, undefined, "/invite", 200);
  run(owner, "DELETE", `${t}/invite`, undefined, "/invite", 204);

  run(guest, "DELETE", `${item}?version=2`, undefined, "/items/:id", 204);
  run(owner, "POST", `${t}/transfer`, { userId: guest }, "/transfer", 204);
  run(owner, "POST", `${t}/leave`, undefined, "/leave", 204);

  const made5 = run(owner, "POST", "/trips", input, "/trips", 201);
  const t2 = `/trips/${made5.trip.tripId}`;
  run(guest, "POST", `/join/${made5.invite.token}`, undefined, "/join/:token", 201);
  run(owner, "POST", `${t2}/join-requests/${guest}/approve`, undefined, "/approve", 200);
  run(owner, "DELETE", `${t2}/members/${guest}`, undefined, "/members/:id", 204);
  run(owner, "DELETE", t2, undefined, "/trips/:id", 204);
  run(guest, "DELETE", t, undefined, "/trips/:id", 204);
  run(other, "DELETE", "/me", undefined, "/me", 204);
  sleep(0.2);
}

export const handleSummary = summary;
