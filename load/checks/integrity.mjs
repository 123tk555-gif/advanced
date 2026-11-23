// L6 整合性: 同時の操作で、消失・二重・上限超え・精算のずれが起きないか
import { call, generateKeyBetween, inBatches, must, seedTrip } from "./common.mjs";

const all = (list, run) => Promise.all(list.map(run));
const range = (n) => Array.from({ length: n }, (_, i) => i);
const countOf = (results, status) => results.filter((r) => r.status === status).length;
const server = (results) => results.filter((r) => r.status >= 500 || r.status === 0).length;

export async function integrity({ quick }) {
  const N = quick ? 10 : 50;
  const cases = [];
  function report(name, results, checks) {
    const statuses = {};
    for (const r of results) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    const all = { "5xx が 0": server(results) === 0, ...checks };
    const row = { name, statuses, checks: all, ok: Object.values(all).every(Boolean) };
    cases.push(row);
    console.log("  L6", JSON.stringify(row));
  }

  {
    const t = await seedTrip(N);
    const { item } = await must(t.ids[0], "POST", `${t.base}/items`, {
      day: 1,
      order: "a0",
      title: "元",
    });
    const path = `${t.base}/items/${item.itemId}`;
    const res = await all(t.ids, (id) => call(id, "PATCH", path, { version: 1, title: id }));
    const view = await must(t.ids[0], "GET", t.base);
    const winner = t.ids[res.findIndex((r) => r.status === 200)];
    report("同じ予定を同時に更新", res, {
      "成功は 1 件": countOf(res, 200) === 1,
      "ほかは 409": countOf(res, 409) === N - 1,
      成功した内容が残る: view.items[0].title === winner && view.items[0].version === 2,
    });
  }

  // 件数の上限ちょうどへの駆け込み。room 件の空きに N 人が同時に追加する
  const limits = [
    ["予定", "items", 300, (i, order) => ({ day: 1, order, title: `予定${i}` })],
    ["候補", "ideas", 100, (i) => ({ name: `候補${i}` })],
    [
      "支出",
      "expenses",
      500,
      (i, _order, ids) => ({ title: `支出${i}`, amount: 100, paidBy: ids[0], splitWith: [ids[0]] }),
    ],
  ];
  for (const [label, key, max, body] of limits) {
    const t = await seedTrip(N);
    const room = Math.floor(N / 2);
    const orders = [];
    let order = null;
    for (let i = 0; i < max + N; i++) {
      order = generateKeyBetween(order, null);
      orders.push(order);
    }
    await inBatches(range(max - room), 8, async (i) => {
      for (let attempt = 0; attempt < 20; attempt++) {
        const r = await call(t.ids[0], "POST", `${t.base}/${key}`, body(i, orders[i], t.ids));
        if (r.status === 201) return;
      }
      throw new Error(`${label} の準備に失敗`);
    });
    const res = await all(range(N), (i) =>
      call(t.ids[i], "POST", `${t.base}/${key}`, body(max + i, orders[max + i], t.ids)),
    );
    const view = await must(t.ids[0], "GET", t.base);
    report(`${label}の上限 ${max} 件への駆け込み`, res, {
      [`成功は ${room} 件`]: countOf(res, 201) === room,
      上限ちょうど: view[key].length === max,
    });
  }

  {
    const t = await seedTrip(N);
    const { item } = await must(t.ids[0], "POST", `${t.base}/items`, {
      day: 1,
      order: "a0",
      title: "予定",
    });
    const path = `${t.base}/items/${item.itemId}/comments`;
    const room = Math.floor(N / 2);
    for (let i = 0; i < 200 - room; i++) await must(t.ids[0], "POST", path, { body: `${i}` });
    const res = await all(t.ids, (id) => call(id, "POST", path, { body: id }));
    const view = await must(t.ids[0], "GET", t.base);
    report("コメントの上限 200 件への駆け込み", res, {
      [`成功は ${room} 件`]: countOf(res, 201) === room,
      上限ちょうど: view.items[0].comments.length === 200,
    });
  }

  {
    const t = await seedTrip(40);
    const guests = range(20).map((i) => `${t.ids[0]}guest${i}`);
    for (const id of guests) {
      await must(id, "PUT", "/me", { displayName: "申請者" });
      await must(id, "POST", `/join/${t.inviteToken}`);
    }
    const res = await all(guests, (id) =>
      call(t.ids[0], "POST", `${t.base}/join-requests/${id}/approve`),
    );
    const view = await must(t.ids[0], "GET", t.base);
    report("50 人の上限への同時承認", res, {
      "成功は 10 人": countOf(res, 200) === 10,
      "50 人ちょうど": view.members.length === 50 && view.trip.memberCount === 50,
    });
  }

  {
    const t = await seedTrip(N);
    const { idea } = await must(t.ids[0], "POST", `${t.base}/ideas`, { name: "人気" });
    const path = `${t.base}/ideas/${idea.ideaId}`;
    const votes = await all([...t.ids, ...t.ids], (id) => call(id, "PUT", `${path}/vote`));
    let view = await must(t.ids[0], "GET", t.base);
    report("同時投票(全員が 2 回ずつ)", votes, { "1 人 1 票": view.ideas[0].voteCount === N });

    const adopted = await all(t.ids, (id) =>
      call(id, "POST", `${path}/adopt`, { day: 1, order: "a0" }),
    );
    view = await must(t.ids[0], "GET", t.base);
    report("同時採用", adopted, {
      "成功は 1 件": countOf(adopted, 201) === 1,
      "予定は 1 件": view.items.length === 1,
    });
  }

  {
    const t = await seedTrip(N);
    const made = [];
    for (const i of range(N)) {
      made.push(
        (await must(t.ids[0], "POST", `${t.base}/ideas`, { name: `消す${i}` })).idea.ideaId,
      );
    }
    const res = await all(made, (id) => call(t.ids[0], "DELETE", `${t.base}/ideas/${id}`));
    const view = await must(t.ids[0], "GET", t.base);
    report("候補の同時削除", res, { すべて消える: view.ideas.length === 0 });
  }

  {
    const t = await seedTrip(N);
    const res = await all(t.ids, (id, i) =>
      call(id, "POST", `${t.base}/expenses`, {
        title: "同時の支出",
        amount: 10001 + i * 37,
        paidBy: id,
        splitWith: t.ids,
      }),
    );
    const view = await must(t.ids[0], "GET", t.base);
    // 仕様(切り捨て、端数は払った人)から別に計算した差し引きと突き合わせる
    const expected = new Map(t.ids.map((id) => [id, 0]));
    t.ids.forEach((payer, i) => {
      if (res[i].status !== 201) return;
      const share = Math.floor((10001 + i * 37) / N);
      for (const id of t.ids) {
        if (id === payer) continue;
        expected.set(id, expected.get(id) - share);
        expected.set(payer, expected.get(payer) + share);
      }
    });
    for (const s of view.settlement) {
      expected.set(s.from, expected.get(s.from) + s.amount);
      expected.set(s.to, expected.get(s.to) - s.amount);
    }
    report("同時の支出と精算", res, {
      全件が残る: countOf(res, 201) === N && view.expenses.length === N,
      "精算のずれ 0 円": [...expected.values()].every((v) => v === 0),
    });
  }

  for (const key of ["invite", "public"]) {
    const t = await seedTrip(2);
    const res = await all(range(Math.min(N, 20)), () => call(t.ids[0], "POST", `${t.base}/${key}`));
    const tokens = res.filter((r) => r.status === 200).map((r) => r.data[key].token);
    const path = key === "invite" ? "/join/" : "/public/";
    const probes = await all(tokens, (token) => call(t.ids[1], "GET", `${path}${token}`));
    report(`${key === "invite" ? "招待" : "公開"}リンクの同時発行`, res, {
      "使えるリンクは 1 本": countOf(probes, 200) === 1,
    });
  }

  return { cases, pass: cases.every((c) => c.ok) };
}
