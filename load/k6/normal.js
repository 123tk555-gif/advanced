// L2 通常・L4 限界探し・L7 長時間: 1 人 1 秒に 1 操作(読み 9:書き 1)。WITH_WS=1 で WebSocket も張る
import { sleep } from "k6";
import { SharedArray } from "k6/data";
import exec from "k6/execution";
import { Counter } from "k6/metrics";
import { clearInterval, setInterval, setTimeout } from "k6/timers";
import { call, connect, summary, TREND_STATS } from "./lib.js";

const users = new SharedArray("users", () => JSON.parse(open(__ENV.SEED)).users);
const VUS = Number(__ENV.VUS);
const SECONDS = Number(__ENV.SECONDS);
const WITH_WS = __ENV.WITH_WS === "1";

const changed = new Counter("ws_changed");
const wsFailed = new Counter("ws_failed");

const scenarios = {
  operations: {
    executor: "ramping-vus",
    exec: "operate",
    startVUs: 0,
    stages: [
      { duration: "15s", target: VUS },
      { duration: `${SECONDS}s`, target: VUS },
    ],
    gracefulRampDown: "5s",
  },
};
if (WITH_WS) {
  scenarios.sockets = {
    executor: "per-vu-iterations",
    exec: "listen",
    vus: VUS,
    iterations: 1,
    maxDuration: `${SECONDS + 60}s`,
  };
}

export const options = {
  scenarios,
  thresholds: {
    app_errors: ["rate<0.01"],
    app_read_ms: ["p(95)<500"],
    app_write_ms: ["p(95)<1000"],
  },
  summaryTrendStats: TREND_STATS,
};

// 1 人分の状態(k6 では VU ごとに別々に持たれる)
let me = null;
let version = 1;
let voted = false;
let commentId = null;
let expenseId = null;

function write() {
  const trip = `/trips/${me.tripId}`;
  const kind = Math.floor(Math.random() * 4);
  if (kind === 0) {
    const body = { version, title: `予定 ${Date.now()}` };
    const r = call(me.userId, "PATCH", `${trip}/items/${me.itemId}`, body, "/items/:id");
    if (r.status === 200) version = r.data.item.version;
    else if (r.status === 409 && r.data) version = r.data.current.version;
  } else if (kind === 1) {
    const method = voted ? "DELETE" : "PUT";
    const r = call(me.userId, method, `${trip}/ideas/${me.ideaId}/vote`, undefined, "/vote");
    if (r.status === 204) voted = !voted;
  } else if (kind === 2) {
    // 件数の上限に当たらないよう、書いたら次は消す
    const path = `${trip}/items/${me.itemId}/comments`;
    if (commentId) {
      call(me.userId, "DELETE", `${path}/${commentId}`, undefined, "/comments/:id");
      commentId = null;
    } else {
      const r = call(me.userId, "POST", path, { body: "楽しみです" }, "/comments");
      if (r.status === 201) commentId = r.data.comment.commentId;
    }
  } else if (expenseId) {
    call(me.userId, "DELETE", `${trip}/expenses/${expenseId}`, undefined, "/expenses/:id");
    expenseId = null;
  } else {
    const body = { title: "昼", amount: 1200, paidBy: me.userId, splitWith: [me.userId] };
    const r = call(me.userId, "POST", `${trip}/expenses`, body, "/expenses");
    if (r.status === 201) expenseId = r.data.expense.expenseId;
  }
}

export function operate() {
  if (!me) {
    me = users[(exec.vu.idInTest - 1) % users.length];
    version = me.version;
    sleep(Math.random());
  }
  const began = Date.now();
  if (Math.random() < 0.1) write();
  else if (Math.random() < 0.85) {
    call(me.userId, "GET", `/trips/${me.tripId}`, undefined, "/trips/:id");
  } else {
    call(me.userId, "GET", "/trips", undefined, "/trips");
  }
  sleep(Math.max(0, 1 - (Date.now() - began) / 1000));
}

export async function listen() {
  const user = users[(exec.vu.idInTest - 1) % users.length];
  let done = false;
  let ping = null;
  const ws = await connect(user.userId, user.tripId, {
    onMessage(message, socket) {
      if (message.type === "changed") changed.add(1);
      if (message.type === "presence" && !ping) {
        ping = setInterval(() => socket.send('{"type":"ping"}'), 60000);
      }
    },
    onFail: () => wsFailed.add(1),
    onClose() {
      if (!done) wsFailed.add(1);
      if (ping) clearInterval(ping);
    },
  });
  if (!ws) return;
  setTimeout(
    () => {
      done = true;
      if (ping) clearInterval(ping);
      ws.close();
    },
    (SECONDS + 18) * 1000,
  );
}

export const handleSummary = summary;
