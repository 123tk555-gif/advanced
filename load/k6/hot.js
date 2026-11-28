// L3 集中: 50 人が同じ旅に接続し、2 秒に 1 回の変更。
// 読み直しは画面(web/app/utils/realtime/refresh.ts)と同じ: 合図から 250ms + 0〜500ms ずらして、前回から 2 秒はあける

import { SharedArray } from "k6/data";
import exec from "k6/execution";
import { Counter, Trend } from "k6/metrics";
import { clearInterval, clearTimeout, setInterval, setTimeout } from "k6/timers";
import { call, callAsync, connect, summary, TREND_STATS } from "./lib.js";

const seeds = new SharedArray("seed", () => [JSON.parse(open(__ENV.SEED))]);
const SECONDS = Number(__ENV.SECONDS);
const WARMUP = 20;
const DRAIN = 15;
const WRITES = Math.floor(SECONDS / 2);

const delivery = new Trend("delivery_ms", true);
const signals = new Counter("ws_signals");
const writes = new Counter("writes_ok");
const caughtUp = new Counter("receivers_caught_up");
const wsFailed = new Counter("ws_failed");

export const options = {
  scenarios: {
    receivers: {
      executor: "per-vu-iterations",
      exec: "receive",
      vus: Number(__ENV.VUS),
      iterations: 1,
      maxDuration: `${WARMUP + SECONDS + DRAIN + 30}s`,
    },
    writer: {
      executor: "shared-iterations",
      exec: "change",
      vus: 1,
      iterations: 1,
      startTime: `${WARMUP}s`,
      maxDuration: `${SECONDS + 20}s`,
    },
  },
  thresholds: { delivery_ms: ["p(95)<2000"], app_errors: ["rate<0.01"] },
  summaryTrendStats: TREND_STATS,
};

export function change() {
  const { users, tripId, itemId, version } = seeds[0];
  let current = version;
  const began = Date.now();
  return new Promise((resolve) => {
    const step = (n) => {
      if (n > WRITES) return resolve();
      const title = `seq:${n}:${Date.now()}`;
      const body = { version: current, title };
      const path = `/trips/${tripId}/items/${itemId}`;
      const r = call(users[0].userId, "PATCH", path, body, "/items/:id");
      if (r.status === 200) {
        current = r.data.item.version;
        writes.add(1);
      }
      setTimeout(() => step(n + 1), Math.max(0, began + n * 2000 - Date.now()));
    };
    step(1);
  });
}

export async function receive() {
  const { users, tripId, itemId } = seeds[0];
  const user = users[(exec.vu.idInTest - 1) % users.length];
  let timer = null;
  let running = false;
  let pending = false;
  let last = 0;
  let done = false;
  let lastStart = -1e9;
  const schedule = () => {
    if (timer !== null || running) return;
    const settle = 250 + Math.floor(Math.random() * 500);
    timer = setTimeout(load, Math.max(settle, lastStart + 2000 - Date.now()));
  };

  async function load() {
    timer = null;
    if (running || !pending || done) return;
    pending = false;
    running = true;
    lastStart = Date.now();
    const res = await callAsync(user.userId, "GET", `/trips/${tripId}`, "/trips/:id");
    if (res.status === 200) {
      const found = res.json("items").find((item) => item.itemId === itemId);
      const m = found ? /^seq:(\d+):(\d+)$/.exec(found.title) : null;
      if (m && Number(m[1]) > last) {
        last = Number(m[1]);
        delivery.add(Date.now() - Number(m[2]));
      }
    }
    running = false;
    if (pending) schedule();
  }

  const ws = await connect(user.userId, tripId, {
    onMessage(message) {
      if (message.type !== "changed") return;
      signals.add(1);
      pending = true;
      schedule();
    },
    onFail: () => wsFailed.add(1),
  });
  if (!ws) return;
  const ping = setInterval(() => ws.send('{"type":"ping"}'), 60000);
  setTimeout(
    () => {
      done = true;
      if (timer !== null) clearTimeout(timer);
      clearInterval(ping);
      if (last === WRITES) caughtUp.add(1);
      ws.close();
    },
    (WARMUP + SECONDS + DRAIN) * 1000,
  );
}

export const handleSummary = summary;
