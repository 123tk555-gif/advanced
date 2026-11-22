import { beforeEach, describe, expect, it } from "vitest";
import { useTestApi, validTrip } from "./helpers.js";

/** 通信の方式(API Gateway / 手元の ws)に依存しない部分の結合テスト */
const api = useTestApi();
const rt = api.realtime;
const box = api.outbox;

let n = 0;
let owner = "";
let friend = "";
let trip = { tripId: "", inviteToken: "" };

beforeEach(async () => {
  n += 1;
  owner = `owner${n}`;
  friend = `friend${n}`;
  api.clock.reset();
  await api.signUp(owner, "たろう");
  trip = await api.createTrip(owner);
  await api.addMember(trip, owner, friend);
  box.clear();
});

async function ticketFor(userId: string, tripId = trip.tripId) {
  const res = await api.call(userId, "POST", `/trips/${tripId}/ws-ticket`);
  expect(res.status).toBe(200);
  return res.body.ticket as string;
}

let connections = 0;
async function open(userId: string, tripId = trip.tripId) {
  connections += 1;
  const id = `c${connections}`;
  expect(await rt.connect(id, await ticketFor(userId, tripId))).toBe(true);
  await rt.message(id, '{"type":"hello"}');
  return id;
}

const base = () => `/trips/${trip.tripId}`;
const newItem = () => ({ day: 1, order: "a0", title: "清水寺" });

describe("接続のチケット", () => {
  it("1 回だけ使える", async () => {
    const ticket = await ticketFor(owner);
    expect(await rt.connect("once-1", ticket)).toBe(true);
    expect(await rt.connect("once-2", ticket)).toBe(false);
  });

  it("同時に 2 回使っても、1 回だけつながる", async () => {
    const ticket = await ticketFor(owner);
    const results = await Promise.all([rt.connect("race-1", ticket), rt.connect("race-2", ticket)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("30 秒を過ぎると使えない", async () => {
    const ticket = await ticketFor(owner);
    api.clock.advanceSeconds(31);
    expect(await rt.connect("late", ticket)).toBe(false);
  });

  it("無いチケット・形の違うチケットでは、つながらない", async () => {
    for (const ticket of ["", "x", "#".repeat(43), "A".repeat(43), "A".repeat(5000)]) {
      expect(await rt.connect("bad", ticket)).toBe(false);
    }
  });

  it("受け取った後で外された人は、つながらない", async () => {
    const ticket = await ticketFor(friend);
    await api.call(owner, "DELETE", `${base()}/members/${friend}`);
    expect(await rt.connect("removed", ticket)).toBe(false);
  });

  it("メンバーでない人には出さない", async () => {
    await api.signUp(`stranger${n}`);
    expect((await api.call(`stranger${n}`, "POST", `${base()}/ws-ticket`)).status).toBe(404);
  });
});

describe("変更の通知", () => {
  it("同じ旅の全員に届き、別の旅には届かない。中身は載せない", async () => {
    const a = await open(owner);
    const b = await open(friend);
    const other = await api.createTrip(owner);
    const c = await open(owner, other.tripId);
    box.clear();

    expect((await api.call(owner, "POST", `${base()}/items`, newItem())).status).toBe(201);
    for (const id of [a, b]) {
      expect(box.of(id)).toContainEqual({ type: "changed" });
      expect(JSON.stringify(box.of(id))).not.toContain("清水寺");
    }
    expect(box.of(c)).toEqual([]);
  });

  it("もう無い接続は消し、ほかの人には届ける", async () => {
    const a = await open(owner);
    const b = await open(friend);
    box.gone.add(b);
    box.clear();
    await api.call(owner, "POST", `${base()}/items`, newItem());
    expect(box.types(a)).toContain("changed");
    expect(box.lastPresence(a)).toMatchObject({ people: [{ userId: owner }] });
    expect(await api.countConnections(trip.tripId)).toBe(1);
  });

  it("送信に失敗しても、保存は成功し、ほかの人には届く", async () => {
    const a = await open(owner);
    const b = await open(friend);
    box.broken.add(b);
    box.clear();
    expect((await api.call(owner, "POST", `${base()}/items`, newItem())).status).toBe(201);
    expect(box.types(a)).toContain("changed");
  });
});

describe("見られなくなった人", () => {
  async function expectRevoked(id: string) {
    expect(box.types(id)).toEqual(["revoked"]);
    expect(box.closed.has(id)).toBe(true);
  }

  it("外されたら、知らせて切る。変更の合図は送らない", async () => {
    const a = await open(owner);
    const b = await open(friend);
    box.clear();
    await api.call(owner, "DELETE", `${base()}/members/${friend}`);
    await expectRevoked(b);
    expect(box.lastPresence(a)).toMatchObject({ people: [{ userId: owner }] });
  });

  it("自分で抜けたら、ほかのタブも切る", async () => {
    const tab1 = await open(friend);
    const tab2 = await open(friend);
    box.clear();
    await api.call(friend, "POST", `${base()}/leave`);
    await expectRevoked(tab1);
    await expectRevoked(tab2);
  });

  it("退会したら切る(メンバー情報は残るので、明示して切る)", async () => {
    const a = await open(owner);
    const b = await open(friend);
    box.clear();
    await api.call(friend, "DELETE", "/me");
    await expectRevoked(b);
    expect(box.types(a)).toContain("changed");
    expect(box.lastPresence(a)).toMatchObject({ people: [{ userId: owner }] });
  });

  it("旅が削除されたら、全員を切る", async () => {
    const a = await open(owner);
    const b = await open(friend);
    box.clear();
    await api.call(owner, "DELETE", base());
    await expectRevoked(a);
    await expectRevoked(b);
    expect(await api.countConnections(trip.tripId)).toBe(0);
  });
});

describe("今見ている人・編集中", () => {
  it("同じ人の複数タブは 1 人にまとめる", async () => {
    const a = await open(owner);
    await open(owner);
    await open(friend);
    const seen = box.lastPresence(a);
    expect(seen?.type === "presence" && seen.people).toHaveLength(2);
  });

  it("編集中が出て、終えると消える", async () => {
    const a = await open(owner);
    const b = await open(friend);
    await rt.message(b, '{"type":"editing","itemId":"item1"}');
    expect(box.lastPresence(a)).toMatchObject({
      editing: [{ itemId: "item1", userId: friend, displayName: friend }],
    });
    await rt.message(b, '{"type":"editing","itemId":null}');
    expect(box.lastPresence(a)).toMatchObject({ editing: [] });
  });

  it("切断すると、見ている人からも編集中からも消える", async () => {
    const a = await open(owner);
    const b = await open(friend);
    await rt.message(b, '{"type":"editing","itemId":"item1"}');
    await rt.disconnect(b);
    expect(box.lastPresence(a)).toMatchObject({ people: [{ userId: owner }], editing: [] });
  });

  it("表示名を変えると、見ている人の名前も変わる", async () => {
    const a = await open(owner);
    await open(friend);
    await api.call(friend, "PUT", "/me", { displayName: "はなこ" });
    const seen = box.lastPresence(a);
    expect(seen?.type === "presence" && seen.people).toContainEqual({
      userId: friend,
      displayName: "はなこ",
    });
  });

  it("新しい知らせほど seq が大きい(追い越されても、画面で古い方を捨てられる)", async () => {
    const a = await open(owner);
    await open(friend);
    const seqs = box.of(a).flatMap((m) => (m.type === "presence" ? [m.seq] : []));
    expect(seqs.length).toBeGreaterThan(1);
    expect(seqs).toEqual([...new Set(seqs)].sort((x, y) => x - y));
  });

  it("150 秒音沙汰のない接続は、ほかの人の ping のときに消える", async () => {
    const a = await open(owner);
    await open(friend);
    api.clock.advanceSeconds(100);
    await rt.message(a, '{"type":"ping"}');
    expect(box.types(a)).toContain("pong");
    api.clock.advanceSeconds(60);
    await rt.message(a, '{"type":"ping"}');
    expect(box.lastPresence(a)).toMatchObject({ people: [{ userId: owner }] });
    expect(await api.countConnections(trip.tripId)).toBe(1);
  });

  it("登録の無い接続は切る(画面がつなぎ直す)", async () => {
    await rt.message("unknown", '{"type":"hello"}');
    expect(box.closed.has("unknown")).toBe(true);
    expect(box.types("unknown")).not.toContain("revoked");
  });

  it("読めないメッセージは捨てる", async () => {
    const a = await open(owner);
    box.clear();
    await rt.message(a, '{"type":"editing","itemId":"x","userId":"someone"}');
    expect(box.of(a)).toEqual([]);
  });

  it("旅の情報の変更も届く", async () => {
    const b = await open(friend);
    box.clear();
    await api.call(owner, "PATCH", base(), { ...validTrip, title: "新しい題名" });
    expect(box.types(b)).toContain("changed");
  });
});
