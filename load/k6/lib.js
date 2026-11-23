// k6 の試験で共通に使う部品
import http from "k6/http";
import { Counter, Rate, Trend } from "k6/metrics";
import { setTimeout } from "k6/timers";
import { WebSocket } from "k6/websockets";

export const BASE = __ENV.BASE_URL;
export const ORIGIN = __ENV.WEB_ORIGIN;

export const readMs = new Trend("app_read_ms", true);
export const writeMs = new Trend("app_write_ms", true);
export const appErrors = new Rate("app_errors");
export const conflicts = new Counter("app_conflicts");
export const status5xx = new Counter("app_5xx");

// 仕様どおりの 409(衝突)は通信の失敗に数えない
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 409));

function options(user, route) {
  const headers = { "content-type": "application/json" };
  if (user) headers["x-dev-user-id"] = user;
  return { headers, tags: { name: route }, timeout: "35s" };
}

function record(method, route, res) {
  const ok = (res.status >= 200 && res.status < 300) || res.status === 409;
  (method === "GET" ? readMs : writeMs).add(res.timings.duration, { name: route });
  appErrors.add(!ok);
  if (res.status === 409) conflicts.add(1);
  if (res.status >= 500) status5xx.add(1);
}

/** API を呼んで記録する。route は集計用の名前(ID を含めない) */
export function call(user, method, path, body, route) {
  const name = `${method} ${route}`;
  const payload = body === undefined ? null : JSON.stringify(body);
  const res = http.request(method, BASE + path, payload, options(user, name));
  record(method, name, res);
  let data = null;
  if (res.body && res.status < 500) {
    try {
      data = res.json();
    } catch {
      // 本文が JSON でない
    }
  }
  return { status: res.status, data };
}

/** WebSocket の処理を止めずに呼ぶ */
export async function callAsync(user, method, path, route) {
  const name = `${method} ${route}`;
  const res = await http.asyncRequest(method, BASE + path, null, options(user, name));
  record(method, name, res);
  return res;
}

/** チケットを取ってつなぐ */
export async function connect(user, tripId, handlers, attempt = 0) {
  const res = await callAsync(user, "POST", `/trips/${tripId}/ws-ticket`, "/trips/:id/ws-ticket");
  // 画面と同じく、通信の失敗ならやり直す(試験の道具の Docker の中継が、一斉の接続で時間切れになることがある)
  if (res.status === 0 && attempt < 3) {
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    return connect(user, tripId, handlers, attempt + 1);
  }
  if (res.status !== 200) {
    console.error(
      `ticket failed: status=${res.status} error=${res.error_code} ${String(res.body).slice(0, 120)}`,
    );
    handlers.onFail?.();
    return null;
  }
  const url = `${BASE.replace(/^http/, "ws")}/ws?ticket=${res.json("ticket")}`;
  const ws = new WebSocket(url, null, { headers: { Origin: ORIGIN } });
  ws.onopen = () => ws.send(JSON.stringify({ type: "hello" }));
  ws.onmessage = (event) => handlers.onMessage?.(JSON.parse(event.data), ws);
  ws.onerror = () => handlers.onFail?.();
  ws.onclose = () => handlers.onClose?.();
  return ws;
}

/** 結果を JSON で残す */
export function summary(data) {
  return { [__ENV.OUT]: JSON.stringify(data, null, 2), stdout: "" };
}

export const TREND_STATS = ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max", "count"];
