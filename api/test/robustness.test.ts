import { TransactionCanceledException } from "@aws-sdk/client-dynamodb";
import {
  BatchWriteCommand,
  GetCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTestApi, validTrip } from "./helpers.js";

/**
 * 品質チェック(2026-11-22)で見つけた、同時操作・上限・異常系の不具合の再現。
 * どれも「正しくはこう動く」を書いてある。
 */
const api = useTestApi();

let n = 0;
let owner = "";
let friend = "";
let third = "";
let trip = { tripId: "", inviteToken: "" };
const base = () => `/trips/${trip.tripId}`;

beforeEach(async () => {
  n += 1;
  owner = `owner${n}`;
  friend = `friend${n}`;
  third = `third${n}`;
  await api.signUp(owner);
  trip = await api.createTrip(owner);
  await api.addMember(trip, owner, friend);
  await api.addMember(trip, owner, third);
});
afterEach(() => vi.restoreAllMocks());

type Send = (command: unknown) => Promise<unknown>;

/** DB への書き込みの直前に割り込む。before が true を返した回は、同時更新の衝突にする */
function intercept(before: (command: unknown) => Promise<boolean> | boolean) {
  const db = api.db as unknown as { send: Send };
  const original = db.send.bind(db);
  vi.spyOn(db, "send").mockImplementation(async (command) => {
    if (await before(command)) {
      throw new TransactionCanceledException({
        $metadata: {},
        message: "conflict",
        CancellationReasons: [{ Code: "TransactionConflict" }],
      });
    }
    return original(command);
  });
}

/** TransactWrite を最初の times 回だけ衝突させる(DynamoDB Local では起きないが AWS では起きる) */
function conflictTimes(times: number) {
  let left = times;
  intercept((command) => command instanceof TransactWriteCommand && left-- > 0);
}

describe("同時操作", () => {
  it("候補の削除は、同時の書き込みとぶつかってもやり直す", async () => {
    const idea = await api.call(owner, "POST", `${base()}/ideas`, { name: "平等院" });
    conflictTimes(1);
    const res = await api.call(owner, "DELETE", `${base()}/ideas/${idea.body.idea.ideaId}`);
    expect(res.status).toBe(204);
  });

  it("衝突が続いても 500 にせず、混み合っていると返す", async () => {
    conflictTimes(100);
    const res = await api.call(owner, "POST", `${base()}/items`, {
      day: 1,
      order: "a0",
      title: "朝",
    });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("BUSY");
  });

  it("招待リンクの発行し直しが重なっても 500 にしない", async () => {
    let first = true;
    intercept(async (command) => {
      if (command instanceof TransactWriteCommand && first) {
        first = false;
        await api.call(owner, "POST", `${base()}/invite`);
      }
      return false;
    });
    expect((await api.call(owner, "POST", `${base()}/invite`)).status).toBe(200);
  });

  it("公開リンクの発行が重なっても 500 にしない", async () => {
    let first = true;
    intercept(async (command) => {
      if (command instanceof TransactWriteCommand && first) {
        first = false;
        await api.call(owner, "POST", `${base()}/public`);
      }
      return false;
    });
    expect((await api.call(owner, "POST", `${base()}/public`)).status).toBe(200);
  });

  it("日程の短縮と予定の追加が重なっても、日程の外に予定が残らない", async () => {
    let first = true;
    intercept(async (command) => {
      if (command instanceof UpdateCommand && first) {
        first = false;
        await api.call(friend, "POST", `${base()}/items`, { day: 3, order: "a0", title: "最終日" });
      }
      return false;
    });
    await api.call(owner, "PATCH", base(), { ...validTrip, endDate: validTrip.startDate });
    const { body } = await api.call(owner, "GET", base());
    const days = (Date.parse(body.trip.endDate) - Date.parse(body.trip.startDate)) / 86_400_000 + 1;
    for (const item of body.items) expect(item.day).toBeLessThanOrEqual(days);
  });

  it("退会の引き継ぎ先が同時に抜けたら、次の人に引き継ぐ", async () => {
    let first = true;
    intercept(async (command) => {
      if (command instanceof TransactWriteCommand && first) {
        first = false;
        await api.call(friend, "POST", `${base()}/leave`);
      }
      return false;
    });
    await api.call(owner, "DELETE", "/me");
    const { body } = await api.call(third, "GET", base());
    expect(body.trip.ownerId).toBe(third);
  });

  it("抜ける操作と引き継ぎが重なったら、抜けられたふりをしない", async () => {
    let first = true;
    intercept(async (command) => {
      if (command instanceof TransactWriteCommand && first) {
        first = false;
        await api.call(owner, "POST", `${base()}/transfer`, { userId: friend });
      }
      return false;
    });
    const res = await api.call(friend, "POST", `${base()}/leave`);
    expect(res.status).toBe(409);
  });
});

describe("上限・異常系", () => {
  it("抜けた人も含めて投票が 100 を超えた候補も消せる", async () => {
    const idea = await api.call(owner, "POST", `${base()}/ideas`, { name: "人気の場所" });
    const { ideaId } = idea.body.idea;
    const requests = Array.from({ length: 120 }, (_, i) => ({
      PutRequest: {
        Item: {
          PK: `TRIP#${trip.tripId}`,
          SK: `VOTE#${ideaId}#former${i}`,
          ideaId,
          userId: `former${i}`,
        },
      },
    }));
    for (let i = 0; i < requests.length; i += 25) {
      await api.db.send(
        new BatchWriteCommand({ RequestItems: { [api.tableName]: requests.slice(i, i + 25) } }),
      );
    }
    expect((await api.call(owner, "DELETE", `${base()}/ideas/${ideaId}`)).status).toBe(204);
  });

  it.each([
    ["公開しおり", "GET", () => `/public/${"x".repeat(3000)}`],
    ["招待リンク", "GET", () => `/join/${"x".repeat(3000)}`],
    ["予定", "DELETE", () => `${base()}/items/${"x".repeat(1100)}?version=1`],
  ] as const)("長すぎる ID(%s)は 500 ではなく 404", async (_name, method, path) => {
    const res = await api.app.request(path(), { method, headers: { "x-test-user-id": owner } });
    expect(res.status).toBe(404);
  });

  it("想定外の失敗も JSON で返し、内部の情報を出さない", async () => {
    const db = api.db as unknown as { send: Send };
    vi.spyOn(db, "send").mockRejectedValue(new Error("secret table name"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await api.app.request("/trips", { headers: { "x-test-user-id": owner } });
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain("secret");
    expect(JSON.parse(text)).toEqual({ error: "INTERNAL" });
  });
});

describe("退会した人", () => {
  it("旅を読めない", async () => {
    await api.call(friend, "DELETE", "/me");
    expect((await api.call(friend, "GET", base())).status).toBe(404);
  });

  it("旅を書き換えられない", async () => {
    await api.call(friend, "DELETE", "/me");
    const res = await api.call(friend, "POST", `${base()}/items`, {
      day: 1,
      order: "a0",
      title: "退会後",
    });
    expect(res.status).toBe(404);
  });

  it("同じ ID で登録し直しても、前の旅は見えず、名前も戻らない", async () => {
    await api.call(friend, "DELETE", "/me");
    await api.signUp(friend, "別人");
    expect((await api.call(friend, "GET", base())).status).toBe(404);
    const { body } = await api.call(owner, "GET", base());
    const names = body.members.map((m: { displayName: string }) => m.displayName);
    expect(names).not.toContain("別人");
  });
});

describe("一度も使っていない件数", () => {
  it.each([
    ["予定", "items/nothing?version=1"],
    ["支出", "expenses/nothing"],
  ])("%s: 一度も無い旅で、無いものを消しても 404", async (_name, path) => {
    expect((await api.call(owner, "DELETE", `${base()}/${path}`)).status).toBe(404);
  });
});

describe("コメントの上限(旅全体で 2,000 件)", () => {
  it("旅全体のコメントが 2,000 件に達したら、別の予定にも書けない", async () => {
    const make = async (order: string) =>
      (await api.call(owner, "POST", `${base()}/items`, { day: 1, order, title: order })).body.item
        .itemId as string;
    const items = [await make("a0"), await make("a1")];
    // 件数は旅の情報(META)で数えるので、上限の手前まで進めておく(1 件ずつ書くと時間がかかる)
    await api.db.send(
      new UpdateCommand({
        TableName: api.tableName,
        Key: { PK: `TRIP#${trip.tripId}`, SK: "META" },
        UpdateExpression: "SET commentCount = :n",
        ExpressionAttributeValues: { ":n": 1999 },
      }),
    );
    const ok = await api.call(owner, "POST", `${base()}/items/${items[0]}/comments`, { body: "1" });
    expect(ok.status).toBe(201);
    const over = await api.call(owner, "POST", `${base()}/items/${items[1]}/comments`, {
      body: "2",
    });
    expect(over.status).toBe(409);
    expect(over.body.error).toBe("TOO_MANY_TRIP_COMMENTS");
  });

  it("コメントや予定を消すと、旅全体の件数も減る", async () => {
    const add = await api.call(owner, "POST", `${base()}/items`, {
      day: 1,
      order: "a0",
      title: "x",
    });
    const item = `${base()}/items/${add.body.item.itemId}`;
    const c1 = await api.call(owner, "POST", `${item}/comments`, { body: "1" });
    await api.call(owner, "POST", `${item}/comments`, { body: "2" });
    await api.call(owner, "DELETE", `${item}/comments/${c1.body.comment.commentId}`);
    const count = async () =>
      (
        await api.db.send(
          new GetCommand({
            TableName: api.tableName,
            Key: { PK: `TRIP#${trip.tripId}`, SK: "META" },
            ConsistentRead: true,
          }),
        )
      ).Item?.commentCount;
    expect(await count()).toBe(1);
    await api.call(owner, "DELETE", `${item}?version=1`);
    expect(await count()).toBe(0);
  });
});

describe("予定の日付の守り", () => {
  it("日程の外へ予定を動かせない(400)", async () => {
    const add = await api.call(owner, "POST", `${base()}/items`, {
      day: 1,
      order: "a0",
      title: "x",
    });
    const res = await api.call(owner, "PATCH", `${base()}/items/${add.body.item.itemId}`, {
      version: 1,
      day: 4,
      order: "a0",
    });
    expect(res.status).toBe(400);
  });

  it("日程の短縮と予定の移動が重なっても、日程の外に予定が残らない", async () => {
    const add = await api.call(owner, "POST", `${base()}/items`, {
      day: 1,
      order: "a0",
      title: "x",
    });
    let first = true;
    intercept(async (command) => {
      if (command instanceof UpdateCommand && first) {
        first = false;
        await api.call(friend, "PATCH", `${base()}/items/${add.body.item.itemId}`, {
          version: 1,
          day: 3,
          order: "a0",
        });
      }
      return false;
    });
    await api.call(owner, "PATCH", base(), { ...validTrip, endDate: validTrip.startDate });
    const { body } = await api.call(owner, "GET", base());
    const days = (Date.parse(body.trip.endDate) - Date.parse(body.trip.startDate)) / 86_400_000 + 1;
    for (const item of body.items) expect(item.day).toBeLessThanOrEqual(days);
  });
});

describe("退会した人の扱い", () => {
  it("オーナーを引き継ぐ相手に、退会した人は選べない", async () => {
    await api.call(friend, "DELETE", "/me");
    const res = await api.call(owner, "POST", `${base()}/transfer`, { userId: friend });
    expect(res.status).toBe(404);
  });

  it("旅の画面のメンバーには、退会したことが分かる印が付く", async () => {
    await api.call(friend, "DELETE", "/me");
    const { body } = await api.call(owner, "GET", base());
    expect(body.members.find((m: { userId: string }) => m.userId === friend)).toMatchObject({
      displayName: "退会した会員",
      withdrawn: true,
    });
  });
});
