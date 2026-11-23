// L8 一斉再接続: 50 人が同時に切断してすぐつなぎ直す。全員が「50 人見ている」を受け取るまでの時間

import { SharedArray } from "k6/data";
import exec from "k6/execution";
import { Counter, Trend } from "k6/metrics";
import { setTimeout } from "k6/timers";
import { connect, summary, TREND_STATS } from "./lib.js";

const seeds = new SharedArray("seed", () => [JSON.parse(open(__ENV.SEED))]);
const VUS = Number(__ENV.VUS);
const ROUNDS = 5;
const GAP_MS = 22000;

const recovery = new Trend("recovery_ms", true);
const recovered = new Counter("recovered");
const wsFailed = new Counter("ws_failed");

export const options = {
  scenarios: {
    storm: {
      executor: "per-vu-iterations",
      vus: VUS,
      iterations: 1,
      maxDuration: "200s",
    },
  },
  thresholds: { recovery_ms: ["max<10000"], recovered: [`count==${VUS * ROUNDS}`] },
  summaryTrendStats: TREND_STATS,
};

export function setup() {
  return { began: Date.now() };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

export default async function ({ began }) {
  const { users, tripId } = seeds[0];
  const user = users[(exec.vu.idInTest - 1) % users.length];
  let ws = await connect(user.userId, tripId, { onFail: () => wsFailed.add(1) });
  for (let round = 1; round <= ROUNDS; round++) {
    const at = began + round * GAP_MS;
    await wait(at - Date.now());
    if (ws) ws.close();
    // 全員の切断が処理されるより先に「50 人」を見てしまわないよう、少しだけ置く
    const countFrom = at + 500;
    await wait(countFrom - Date.now());
    let seen = false;
    ws = await connect(user.userId, tripId, {
      onMessage(message) {
        if (seen || message.type !== "presence" || message.people.length !== VUS) return;
        seen = true;
        recovery.add(Date.now() - countFrom);
        recovered.add(1);
      },
      onFail: () => wsFailed.add(1),
    });
  }
  await wait(began + (ROUNDS + 1) * GAP_MS - Date.now());
  if (ws) ws.close();
}

export const handleSummary = summary;
