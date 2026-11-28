// 負荷試験の準備と検証で共通に使う部品
import { createRequire } from "node:module";

const require = createRequire(new URL("../../api/package.json", import.meta.url));
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const lib = require("@aws-sdk/lib-dynamodb");

export const { BatchWriteCommand, QueryCommand, ScanCommand, UpdateCommand } = lib;
export const { generateKeyBetween } = await import(
  new URL("../../shared/node_modules/fractional-indexing/src/index.js", import.meta.url).href
);

export const DB_ENDPOINT = "http://127.0.0.1:8001";
export const API = "http://127.0.0.1:8790";

export function openDb() {
  const client = new DynamoDBClient({
    endpoint: DB_ENDPOINT,
    region: "local",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });
  return lib.DynamoDBDocumentClient.from(client);
}

export async function call(user, method, path, body, timeoutMs = 300_000) {
  const headers = { "content-type": "application/json" };
  if (user) headers["x-dev-user-id"] = user;
  const began = performance.now();
  try {
    const res = await fetch(API + path, {
      method,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // JSON でない応答
    }
    const ms = Math.round(performance.now() - began);
    return { status: res.status, data, ms, bytes: Buffer.byteLength(text) };
  } catch (error) {
    const ms = Math.round(performance.now() - began);
    return { status: 0, data: null, ms, bytes: 0, error: error.name };
  }
}

export async function must(user, method, path, body) {
  const res = await call(user, method, path, body);
  if (res.status >= 300 || res.status === 0) {
    throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data;
}

export async function inBatches(list, size, run) {
  const out = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(...(await Promise.all(list.slice(i, i + size).map(run))));
  }
  return out;
}

let serial = 0;
/** members 人のメンバーがいる旅を、API を通して作る */
export async function seedTrip(members) {
  serial += 1;
  const ids = Array.from({ length: members }, (_, i) => `t${serial}u${i}`);
  await inBatches(ids, 10, (id) => must(id, "PUT", "/me", { displayName: `利用者${id}` }));
  const made = await must(ids[0], "POST", "/trips", {
    title: `負荷試験の旅${serial}`,
    startDate: "2027-04-01",
    endDate: "2027-04-30",
  });
  const tripId = made.trip.tripId;
  // 申請は 50 件まで。10 人ずつ申請 → 承認
  for (let i = 1; i < ids.length; i += 10) {
    const group = ids.slice(i, i + 10);
    for (const id of group) await must(id, "POST", `/join/${made.invite.token}`);
    for (const id of group) {
      await must(ids[0], "POST", `/trips/${tripId}/join-requests/${id}/approve`);
    }
  }
  return { tripId, ids, inviteToken: made.invite.token, base: `/trips/${tripId}` };
}

/** ふつうの大きさの中身(予定 30・候補 20・支出 50・コメント 100)を入れる */
export async function fillTypical(trip) {
  const items = [];
  let order = null;
  for (let i = 0; i < 30; i++) {
    order = generateKeyBetween(order, null);
    const body = { day: 1 + (i % 10), order, title: `予定 ${i}`, memo: "集合場所と持ち物の確認" };
    items.push((await must(trip.ids[0], "POST", `${trip.base}/items`, body)).item);
  }
  const ideas = [];
  for (let i = 0; i < 20; i++) {
    ideas.push((await must(trip.ids[0], "POST", `${trip.base}/ideas`, { name: `候補 ${i}` })).idea);
  }
  for (let i = 0; i < 50; i++) {
    const body = { title: `支出 ${i}`, amount: 1000 + i, paidBy: trip.ids[0], splitWith: trip.ids };
    await must(trip.ids[0], "POST", `${trip.base}/expenses`, body);
  }
  for (let i = 0; i < 100; i++) {
    const path = `${trip.base}/items/${items[i % items.length].itemId}/comments`;
    await must(trip.ids[0], "POST", path, { body: `コメント ${i}` });
  }
  return { items, ideas };
}

export async function putAll(db, table, records) {
  const groups = [];
  for (let i = 0; i < records.length; i += 25) groups.push(records.slice(i, i + 25));
  await inBatches(groups, 4, async (group) => {
    let requests = group.map((Item) => ({ PutRequest: { Item } }));
    while (requests?.length) {
      const res = await db.send(new BatchWriteCommand({ RequestItems: { [table]: requests } }));
      requests = res.UnprocessedItems?.[table];
    }
  });
}
