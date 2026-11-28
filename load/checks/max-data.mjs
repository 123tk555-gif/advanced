// L5 最大データ: 仕様の上限まで入れた旅の、応答の大きさ・時間・読み取り容量
import {
  call,
  generateKeyBetween,
  must,
  putAll,
  QueryCommand,
  seedTrip,
  UpdateCommand,
} from "./common.mjs";

// コメントは旅全体で 2,000 件まで(2026-11-23 の修正前は 6 万件。そのときの結果は results/before)
const STEPS = [0, 1000, 2000];
const jp = (n) => "旅".repeat(n);
const id26 = (prefix, i) => `${prefix}${String(i).padStart(26 - prefix.length, "0")}`;

export async function maxData({ db, table, quick }) {
  const trip = await seedTrip(quick ? 3 : 50);
  const { ids, tripId, base } = trip;
  const owner = ids[0];
  const PK = `TRIP#${tripId}`;
  const now = new Date().toISOString();

  // 上限の件数・長さを DB へ直接入れる(API で入れると数時間かかる)。形は api/src/repo と同じ
  const records = [];
  const itemIds = [];
  let order = null;
  for (let i = 0; i < 300; i++) {
    order = generateKeyBetween(order, null);
    const itemId = id26("ITEM", i);
    itemIds.push(itemId);
    records.push({
      PK,
      SK: `ITEM#${itemId}`,
      type: "item",
      itemId,
      day: 1 + (i % 30),
      order,
      time: "09:00",
      title: jp(100),
      place: { placeId: id26("PLACE", i), label: jp(50) },
      memo: jp(1000),
      version: 1,
      updatedBy: owner,
      updatedAt: now,
      commentCount: 200,
    });
  }
  for (let i = 0; i < 100; i++) {
    const ideaId = id26("IDEA", i);
    records.push({
      PK,
      SK: `IDEA#${ideaId}`,
      type: "idea",
      ideaId,
      name: jp(100),
      place: null,
      note: jp(100),
      createdBy: owner,
      createdAt: now,
    });
    for (const userId of ids) {
      const SK = `VOTE#${ideaId}#${userId}`;
      records.push({ PK, SK, type: "vote", ideaId, userId, votedAt: now });
    }
  }
  for (let i = 0; i < 500; i++) {
    const expenseId = id26("EXP", i);
    records.push({
      PK,
      SK: `EXP#${expenseId}`,
      type: "expense",
      expenseId,
      title: jp(50),
      amount: 10000 + i,
      paidBy: ids[i % ids.length],
      splitWith: ids,
      createdBy: owner,
      createdAt: now,
    });
  }
  await putAll(db, table, records);
  await db.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK, SK: "META" },
      UpdateExpression: "SET itemCount = :i, ideaCount = :d, expenseCount = :e",
      ExpressionAttributeValues: { ":i": 300, ":d": 100, ":e": 500 },
    }),
  );
  const pub = await must(owner, "POST", `${base}/public`);

  const comment = (i) => {
    const itemId = itemIds[i % itemIds.length];
    const commentId = id26("C", i);
    return {
      PK,
      SK: `CMT#${itemId}#${commentId}`,
      type: "comment",
      commentId,
      itemId,
      userId: ids[i % ids.length],
      body: jp(200),
      createdAt: now,
    };
  };

  const steps = [];
  let have = 0;
  for (const comments of quick ? STEPS.slice(0, 2) : STEPS) {
    const more = [];
    for (; have < comments; have++) more.push(comment(have));
    await putAll(db, table, more);

    // 読み取り容量(強い整合性)。API が旅を開くときと同じ Query
    let rcu = 0;
    let pages = 0;
    let start;
    do {
      const res = await db.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: "PK = :pk",
          ExpressionAttributeValues: { ":pk": PK },
          ExclusiveStartKey: start,
          ConsistentRead: true,
          ReturnConsumedCapacity: "TOTAL",
        }),
      );
      rcu += res.ConsumedCapacity?.CapacityUnits ?? 0;
      pages += 1;
      start = res.LastEvaluatedKey;
    } while (start);

    const view = await call(owner, "GET", base);
    const shiori = await call(null, "GET", `/public/${pub.public.token}`);
    const patch = await call(owner, "PATCH", base, {
      title: "変更",
      startDate: "2027-04-01",
      endDate: "2027-04-30",
    });
    const row = {
      comments,
      status: view.status,
      ms: view.ms,
      bytes: view.bytes,
      rcu,
      rcuFor50: rcu * 50,
      pages,
      public: { status: shiori.status, ms: shiori.ms, bytes: shiori.bytes },
      patchMs: patch.ms,
    };
    steps.push(row);
    console.log("  L5", JSON.stringify(row));
  }

  // 上限を超えるコメントは断られる
  // (予定ごとの上限に当たらないよう、確かめる予定の件数は 0 にしておく)
  await db.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK, SK: `ITEM#${itemIds[1]}` },
      UpdateExpression: "SET commentCount = :zero",
      ExpressionAttributeValues: { ":zero": 0 },
    }),
  );
  await db.send(
    new UpdateCommand({
      TableName: table,
      Key: { PK, SK: "META" },
      UpdateExpression: "SET commentCount = :n",
      // 小さい規模の試運転でも、上限ちょうどの状態で確かめる
      ExpressionAttributeValues: { ":n": 2000 },
    }),
  );
  const overLimit = await call(owner, "POST", `${base}/items/${itemIds[1]}/comments`, {
    body: "上限",
  });

  const removedItem = await call(owner, "DELETE", `${base}/items/${itemIds[0]}?version=1`);
  const removedTrip = await call(owner, "DELETE", base);
  // 削除は応答の後も裏で続く。項目が残らなくなるまでの時間も測る
  const began = performance.now();
  const count = async () =>
    (
      await db.send(
        new QueryCommand({
          TableName: table,
          KeyConditionExpression: "PK = :pk",
          ExpressionAttributeValues: { ":pk": PK },
          Select: "COUNT",
          ConsistentRead: true,
        }),
      )
    ).Count;
  let left = await count();
  while (left > 0 && performance.now() - began < 600_000) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    left = await count();
  }
  const cleanupMs = Math.round(performance.now() - began) + removedTrip.ms;

  const worst = steps.at(-1);
  return {
    steps,
    deleteItem: { status: removedItem.status, ms: removedItem.ms },
    overLimit: { status: overLimit.status, error: overLimit.data?.error },
    deleteTrip: { status: removedTrip.status, ms: removedTrip.ms, cleanupMs, leftovers: left },
    pass: {
      responseUnder6MB: steps.every((s) => s.status === 200 && s.bytes < 6 * 1024 * 1024),
      readUnder29s: worst.status === 200 && worst.ms < 29000,
      deleteUnder29s: removedTrip.status === 204 && removedTrip.ms < 29000,
      overLimitRejected:
        overLimit.status === 409 && overLimit.data?.error === "TOO_MANY_TRIP_COMMENTS",
    },
  };
}
