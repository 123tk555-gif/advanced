// Tri-Tri プロトタイプ
// 見た目と操作を確かめるための模型。サーバーにはつながず、データはこのブラウザの中だけに保存する。
// 本番では、ここで行っている権限の確認(メンバーか・オーナーか)はすべてサーバー側で行う。

const STORAGE_KEY = "tritri-prototype-v1";
const MAX_MEMBERS = 50;
const MAX_PENDING = 50;
const MAX_TRIP_DAYS = 30;
const INVITE_DAYS = 7;

// ------------------------------------------------------------------
// 小さな道具
// ------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);

/** 画面に出す文字は必ずこれを通す(入力された文字で HTML が壊れたり、スクリプトが動いたりしないように) */
function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

let idCounter = 0;
function newId(prefix) {
  idCounter += 1;
  return `${prefix}${Date.now().toString(36)}${idCounter}`;
}
function newToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const nowIso = () => new Date().toISOString();
const daysFromNow = (n) => new Date(Date.now() + n * 86_400_000).toISOString();

function dateOf(startDate, offset) {
  const d = new Date(`${startDate}T00:00:00`);
  d.setDate(d.getDate() + offset);
  return d;
}
function fmtDay(d) {
  return `${d.getMonth() + 1}/${d.getDate()}(${"日月火水木金土"[d.getDay()]})`;
}
function fmtRange(trip) {
  const s = dateOf(trip.startDate, 0);
  const e = dateOf(trip.endDate, 0);
  return `${s.getFullYear()}年 ${fmtDay(s)} 〜 ${fmtDay(e)}`;
}
function fmtDateTime(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function tripDays(trip) {
  return Math.round((Date.parse(trip.endDate) - Date.parse(trip.startDate)) / 86_400_000) + 1;
}
const yen = (n) => `${n.toLocaleString("ja-JP")} 円`;

// ------------------------------------------------------------------
// 場所の候補(本番は Google の Places API で検索する)
// ------------------------------------------------------------------
const PLACES = [
  { name: "京都駅", lat: 34.9858, lng: 135.7588 },
  { name: "清水寺", lat: 34.9949, lng: 135.785 },
  { name: "伏見稲荷大社", lat: 34.9671, lng: 135.7727 },
  { name: "金閣寺(鹿苑寺)", lat: 35.0394, lng: 135.7292 },
  { name: "銀閣寺(慈照寺)", lat: 35.027, lng: 135.7982 },
  { name: "嵐山 竹林の小径", lat: 35.017, lng: 135.6713 },
  { name: "渡月橋", lat: 35.0128, lng: 135.6778 },
  { name: "二条城", lat: 35.0142, lng: 135.7481 },
  { name: "錦市場", lat: 35.005, lng: 135.7649 },
  { name: "八坂神社", lat: 35.0037, lng: 135.7785 },
  { name: "祇園 花見小路", lat: 35.0019, lng: 135.7752 },
  { name: "南禅寺", lat: 35.0113, lng: 135.7944 },
  { name: "哲学の道", lat: 35.023, lng: 135.7945 },
  { name: "平等院", lat: 34.8893, lng: 135.8077 },
  { name: "京都タワー", lat: 34.9875, lng: 135.7594 },
  { name: "那覇空港", lat: 26.206, lng: 127.6466 },
  { name: "首里城公園", lat: 26.217, lng: 127.7195 },
  { name: "国際通り", lat: 26.2155, lng: 127.689 },
  { name: "沖縄美ら海水族館", lat: 26.6943, lng: 127.8779 },
  { name: "古宇利大橋", lat: 26.6941, lng: 128.0193 },
  { name: "万座毛", lat: 26.505, lng: 127.8506 },
];
const place = (name) => {
  const p = PLACES.find((x) => x.name === name);
  return p ? { ...p } : null;
};

// ------------------------------------------------------------------
// 初期データ
// ------------------------------------------------------------------
function seed() {
  let n = 0;
  const item = (day, time, title, placeName, memo = "", comments = []) => ({
    id: `i${++n}`,
    day,
    time,
    title,
    place: placeName ? place(placeName) : null,
    memo,
    version: 1,
    updatedBy: "u1",
    updatedAt: "2026-11-10T12:00:00.000Z",
    comments,
  });
  return {
    me: "u1",
    theme: "system",
    users: {
      u1: { name: "たろう" },
      u2: { name: "はなこ" },
      u3: { name: "じろう" },
      u4: { name: "さくら" },
      u5: { name: "けんた" },
    },
    trips: [
      {
        id: "t1",
        title: "京都 2泊3日",
        startDate: "2027-04-01",
        endDate: "2027-04-03",
        destination: "京都",
        ownerId: "u1",
        members: [
          { userId: "u1", role: "owner", joinedAt: "2026-11-01T10:00:00.000Z" },
          { userId: "u2", role: "member", joinedAt: "2026-11-02T10:00:00.000Z" },
          { userId: "u3", role: "member", joinedAt: "2026-11-03T10:00:00.000Z" },
        ],
        invite: { token: "kyoto-invite", expiresAt: daysFromNow(5) },
        publicToken: "kyoto-public",
        joinRequests: [{ userId: "u4", requestedAt: "2026-11-13T09:00:00.000Z" }],
        items: [
          item(1, "10:00", "京都駅に集合", "京都駅", "中央口の改札前"),
          item(1, "10:45", "伏見稲荷大社", "伏見稲荷大社", "千本鳥居は混むので早めに", [
            {
              id: "c1",
              userId: "u2",
              body: "歩きやすい靴で!",
              createdAt: "2026-11-11T08:00:00.000Z",
            },
          ]),
          item(1, "13:00", "錦市場で食べ歩き", "錦市場"),
          item(1, "15:30", "八坂神社", "八坂神社"),
          item(1, "18:00", "祇園で夕ごはん", "祇園 花見小路", "予約: 18:00 3名"),
          item(2, "09:00", "嵐山 竹林の小径", "嵐山 竹林の小径"),
          item(2, "11:00", "渡月橋", "渡月橋"),
          item(2, "14:00", "金閣寺", "金閣寺(鹿苑寺)"),
          item(2, "16:00", "二条城", "二条城"),
          item(3, "09:30", "銀閣寺", "銀閣寺(慈照寺)"),
          item(3, "10:30", "哲学の道を散歩", "哲学の道"),
          item(3, "12:00", "南禅寺で湯豆腐", "南禅寺"),
          item(3, "15:00", "京都駅で解散", "京都駅", "おみやげは駅で"),
        ],
        ideas: [
          {
            id: "d1",
            name: "平等院",
            place: place("平等院"),
            note: "抹茶スイーツも食べたい",
            createdBy: "u2",
            votes: ["u2", "u1"],
            adoptedItemId: null,
          },
          {
            id: "d2",
            name: "清水寺",
            place: place("清水寺"),
            note: "夜の特別拝観があれば",
            createdBy: "u3",
            votes: ["u3", "u2"],
            adoptedItemId: null,
          },
          {
            id: "d3",
            name: "京都タワー",
            place: place("京都タワー"),
            note: "",
            createdBy: "u3",
            votes: ["u3"],
            adoptedItemId: null,
          },
        ],
        expenses: [
          {
            id: "e1",
            title: "新幹線のきっぷ(3人分)",
            amount: 42000,
            paidBy: "u1",
            splitWith: ["u1", "u2", "u3"],
            createdAt: "2026-11-05T10:00:00.000Z",
          },
          {
            id: "e2",
            title: "旅館 1泊目",
            amount: 36000,
            paidBy: "u2",
            splitWith: ["u1", "u2", "u3"],
            createdAt: "2026-11-06T10:00:00.000Z",
          },
          {
            id: "e3",
            title: "錦市場の食べ歩き",
            amount: 4500,
            paidBy: "u3",
            splitWith: ["u1", "u2", "u3"],
            createdAt: "2026-11-07T10:00:00.000Z",
          },
        ],
      },
      {
        id: "t2",
        title: "沖縄 夏休み",
        startDate: "2027-08-10",
        endDate: "2027-08-13",
        destination: "沖縄",
        ownerId: "u2",
        members: [
          { userId: "u2", role: "owner", joinedAt: "2026-10-20T10:00:00.000Z" },
          { userId: "u1", role: "member", joinedAt: "2026-10-21T10:00:00.000Z" },
        ],
        // 期限が切れた招待リンク(デモ用)
        invite: { token: "okinawa-expired", expiresAt: daysFromNow(-2) },
        publicToken: null,
        joinRequests: [],
        items: [
          item(1, "11:00", "那覇空港に到着", "那覇空港"),
          item(1, "14:00", "首里城公園", "首里城公園"),
          item(1, "18:00", "国際通りで夕ごはん", "国際通り"),
          item(2, "10:00", "美ら海水族館", "沖縄美ら海水族館"),
          item(2, "15:00", "古宇利大橋", "古宇利大橋"),
        ],
        ideas: [],
        expenses: [],
      },
    ],
  };
}

let state = load();
/** 画面だけの状態(保存しない) */
const ui = {
  mapMode: "walk",
  mapDay: 1,
  mobileView: "list",
  returnTo: null,
  flashItemId: null,
  signupDraft: null,
  /** デモ: ほかの人が編集中の予定 */
  remoteEditing: { tripId: "t1", itemId: "i6", userId: "u2" },
  lastPath: null,
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // 保存が使えない環境では、初期データで動かす
  }
  return seed();
}
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 保存できなくても画面は動かす
  }
}
function commit() {
  save();
  render();
}

// ------------------------------------------------------------------
// データの読み出し
// ------------------------------------------------------------------
const me = () => state.me;
const userName = (id) => state.users[id]?.name ?? "不明な会員";
const tripById = (id) => state.trips.find((t) => t.id === id);
const membership = (trip, userId = me()) => trip?.members.find((m) => m.userId === userId);
const isOwner = (trip) => membership(trip)?.role === "owner";
const myTrips = () =>
  state.trips.filter((t) => membership(t)).sort((a, b) => a.startDate.localeCompare(b.startDate));
const inviteValid = (trip) => trip.invite && Date.parse(trip.invite.expiresAt) > Date.now();
const itemsOfDay = (trip, day) => trip.items.filter((i) => i.day === day);

function inviteUrl(token) {
  return `${location.href.split("#")[0]}#/join/${token}`;
}
function publicUrl(token) {
  return `${location.href.split("#")[0]}#/p/${token}`;
}

// ------------------------------------------------------------------
// 割り勘の精算(shared/src/settlement.ts と同じ計算)
// ------------------------------------------------------------------
function settle(expenses) {
  const balances = new Map();
  const add = (id, diff) => balances.set(id, (balances.get(id) ?? 0) + diff);
  for (const e of expenses) {
    const people = [...new Set(e.splitWith)];
    const share = Math.floor(e.amount / people.length);
    for (const p of people) {
      if (p === e.paidBy) continue;
      add(p, -share);
      add(e.paidBy, share);
    }
  }
  const order = (a, b) => Math.abs(b[1]) - Math.abs(a[1]) || (a[0] < b[0] ? -1 : 1);
  const creditors = [...balances].filter(([, v]) => v > 0).sort(order);
  const debtors = [...balances].filter(([, v]) => v < 0).sort(order);
  const transfers = [];
  let c = 0;
  let d = 0;
  while (c < creditors.length && d < debtors.length) {
    const amount = Math.min(creditors[c][1], -debtors[d][1]);
    transfers.push({ from: debtors[d][0], to: creditors[c][0], amount });
    creditors[c][1] -= amount;
    debtors[d][1] += amount;
    if (creditors[c][1] === 0) c++;
    if (debtors[d][1] === 0) d++;
  }
  return { transfers, balances };
}

// ------------------------------------------------------------------
// 地図(本番は Google マップ。ここでは位置関係だけを描く模型)
// ------------------------------------------------------------------
const MODES = { walk: "徒歩", transit: "公共交通", car: "車" };
const GOOGLE_MODES = { walk: "walking", transit: "transit", car: "driving" };

function distanceKm(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
/** 移動時間の目安(本番は Routes API の結果を使う) */
function legMinutes(a, b, mode) {
  const km = distanceKm(a, b) * 1.3;
  if (mode === "walk") return Math.max(1, Math.round((km / 4.5) * 60));
  if (mode === "car") return Math.max(3, Math.round((km / 22) * 60) + 3);
  return Math.max(5, Math.round((km / 20) * 60) + 8);
}
function fmtMinutes(min) {
  return min >= 60 ? `約 ${Math.floor(min / 60)} 時間 ${min % 60} 分` : `約 ${min} 分`;
}

function renderMap(trip, day) {
  const stops = itemsOfDay(trip, day).filter((i) => i.place);
  const W = 400;
  const H = 300;
  const pad = 40;
  let body = "";
  if (stops.length === 0) {
    body = `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="currentColor">この日は場所のある予定がありません</text>`;
  } else {
    const lats = stops.map((s) => s.place.lat);
    const lngs = stops.map((s) => s.place.lng);
    const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const kx = Math.cos((midLat * Math.PI) / 180);
    const spanX = Math.max((Math.max(...lngs) - Math.min(...lngs)) * kx, 0.01);
    const spanY = Math.max(Math.max(...lats) - Math.min(...lats), 0.01);
    const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
    const cx = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    const cy = midLat;
    const xy = (p) => [W / 2 + (p.lng - cx) * kx * scale, H / 2 - (p.lat - cy) * scale];
    const pts = stops.map((s) => xy(s.place));
    const grid = [60, 140, 220, 300, 380]
      .map(
        (x) =>
          `<line x1="${x}" y1="0" x2="${x - 40}" y2="${H}" stroke="var(--map-road)" stroke-width="6"/>`,
      )
      .join("");
    const hgrid = [50, 130, 210, 280]
      .map(
        (y) =>
          `<line x1="0" y1="${y}" x2="${W}" y2="${y + 20}" stroke="var(--map-road)" stroke-width="5"/>`,
      )
      .join("");
    const river = `<path d="M 250 0 C 230 80, 280 150, 240 220 S 230 300, 220 300" fill="none" stroke="var(--map-water)" stroke-width="14"/>`;
    const route = `<polyline points="${pts.map((p) => p.join(",")).join(" ")}" fill="none" stroke="var(--route)" stroke-width="4" stroke-linejoin="round" ${ui.mapMode === "transit" ? 'stroke-dasharray="10 6"' : ""}/>`;
    // 名前の位置: 近くの名前と重なるときは、上下にずらす
    const placed = [];
    const labels = stops.map((s, i) => {
      const [x, y] = pts[i];
      const anchor = x > W - 120 ? "end" : "start";
      const width = s.place.name.length * 13;
      const left = anchor === "end" ? x - 16 - width : x + 16;
      let ly = y + 5;
      for (let tries = 0; tries < 8; tries++) {
        const hit = placed.find(
          (p) => Math.abs(p.y - ly) < 16 && left < p.left + p.width && p.left < left + width,
        );
        if (!hit) break;
        ly = hit.y + (ly >= hit.y ? 16 : -16);
      }
      placed.push({ left, width, y: ly });
      return { x, y, ly, anchor, tx: anchor === "end" ? x - 16 : x + 16 };
    });
    const circles = stops
      .map((_, i) => {
        const { x, y } = labels[i];
        return `<circle cx="${x}" cy="${y}" r="13" fill="var(--route)" stroke="var(--surface)" stroke-width="3"/>
          <text x="${x}" y="${y + 5}" text-anchor="middle" font-size="14" font-weight="bold" fill="var(--primary-text)">${i + 1}</text>`;
      })
      .join("");
    // 名前は丸の上に重ねて描く(丸に隠れないように)
    const names = stops
      .map((s, i) => {
        const { ly, anchor, tx } = labels[i];
        return `<text x="${tx}" y="${ly}" text-anchor="${anchor}" font-size="13" font-weight="bold" fill="currentColor" stroke="var(--map-land)" stroke-width="4" paint-order="stroke">${i + 1}. ${esc(s.place.name)}</text>`;
      })
      .join("");
    body = grid + hgrid + river + route + circles + names;
  }

  const legs = stops.slice(1).map((s, i) => {
    const prev = stops[i];
    return `<li>${esc(prev.place.name)} → ${esc(s.place.name)}: ${MODES[ui.mapMode]}で${fmtMinutes(legMinutes(prev.place, s.place, ui.mapMode))}</li>`;
  });
  const label = stops.length
    ? `${day}日目の地図。${stops.map((s, i) => `${i + 1} ${s.place.name}`).join("、")}`
    : `${day}日目の地図。場所のある予定はありません`;

  let gmaps = "";
  if (stops.length >= 2) {
    const ll = (p) => `${p.lat},${p.lng}`;
    const url = new URL("https://www.google.com/maps/dir/");
    url.searchParams.set("api", "1");
    url.searchParams.set("origin", ll(stops[0].place));
    url.searchParams.set("destination", ll(stops.at(-1).place));
    if (stops.length > 2)
      url.searchParams.set(
        "waypoints",
        stops
          .slice(1, -1)
          .map((s) => ll(s.place))
          .join("|"),
      );
    url.searchParams.set("travelmode", GOOGLE_MODES[ui.mapMode]);
    gmaps = `<p class="small"><a href="${esc(url)}" target="_blank" rel="noopener">この日の経路を Google マップで開く(新しいタブ)</a></p>`;
  }

  const days = tripDays(trip);
  return `
    <section class="map-panel" aria-labelledby="map-title">
      <h2 id="map-title" class="visually-hidden">地図と経路</h2>
      <div class="map-tools" role="group" aria-label="地図に出す日">
        ${Array.from({ length: days }, (_, i) => i + 1)
          .map(
            (d) =>
              `<button type="button" class="small" data-action="map-day" data-day="${d}" aria-pressed="${d === day}">${d}日目</button>`,
          )
          .join("")}
      </div>
      <div class="map-tools" role="group" aria-label="移動手段">
        ${Object.entries(MODES)
          .map(
            ([k, v]) =>
              `<button type="button" class="small" data-action="map-mode" data-mode="${k}" aria-pressed="${ui.mapMode === k}">${v}</button>`,
          )
          .join("")}
      </div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" style="background: var(--map-land); color: var(--text)">${body}</svg>
      ${legs.length ? `<h3 class="small" style="margin-bottom:0">区間ごとの移動時間(${MODES[ui.mapMode]})</h3><ol class="map-legs">${legs.join("")}</ol>` : ""}
      ${gmaps}
      <p class="small muted">プロトタイプでは地図を簡略化しています。本番では Google マップを表示し、移動時間は Google の経路検索で求めます。</p>
    </section>`;
}

// ------------------------------------------------------------------
// 画面の切り替え(URL の # 以降で決める)
// ------------------------------------------------------------------
function parseRoute() {
  const hash = location.hash.slice(1) || "/";
  const [path, qs] = hash.split("?");
  return { path, seg: path.split("/").filter(Boolean), q: new URLSearchParams(qs ?? "") };
}
const go = (hash) => {
  location.hash = hash;
};

function render() {
  const route = parseRoute();
  const page = resolvePage(route);
  if (page.redirect) {
    go(page.redirect);
    return;
  }
  const main = $("#main");
  main.className = page.narrow ? "narrow" : "";
  main.innerHTML = page.html;
  document.title = `${page.title} | Tri-Tri(プロトタイプ)`;
  renderNav();
  renderDemoBar();
  applyTheme();
  page.after?.();

  // 別の画面に移ったときだけ、見出しに読み上げの位置を移す
  if (ui.lastPath !== route.path) {
    ui.lastPath = route.path;
    const h1 = $("h1", main);
    if (h1) {
      h1.setAttribute("tabindex", "-1");
      h1.focus({ preventScroll: false });
    }
  }
  if (ui.flashItemId) {
    const el = document.getElementById(`item-${ui.flashItemId}`);
    el?.classList.add("flash");
    ui.flashItemId = null;
  }
}

function needLogin(route) {
  ui.returnTo = `#${route.path}${route.q.toString() ? `?${route.q}` : ""}`;
  return { redirect: "#/login" };
}

function resolvePage(route) {
  const [a, b, c] = route.seg;
  if (!a) return { redirect: me() ? "#/trips" : "#/login" };
  if (a === "login") return pageLogin();
  if (a === "signup" && b === "confirm") return pageSignupConfirm();
  if (a === "signup") return pageSignup();
  if (a === "password-reset") return pagePasswordReset();
  if (a === "p" && b) return pagePublic(b);

  if (!me()) return needLogin(route);
  if (a === "trips" && !b) return pageTrips();
  if (a === "trips" && b === "new") return pageNewTrip();
  if (a === "trips" && b) {
    const trip = tripById(b);
    // メンバーでなければ、旅が無いときと同じ「見つかりません」
    if (!trip || !membership(trip)) return pageNotFound();
    if (c === "settings") return pageTripSettings(trip);
    if (!c) return pageTrip(trip, route.q.get("tab") ?? "plan");
  }
  if (a === "join" && b) return pageJoin(b);
  if (a === "settings") return pageSettings();
  return pageNotFound();
}

function renderNav() {
  const nav = $("#nav");
  if (!me()) {
    nav.innerHTML = `<a href="#/login">ログイン</a><a href="#/signup">会員登録</a>`;
    return;
  }
  nav.innerHTML = `
    <a href="#/trips">旅の一覧</a>
    <a href="#/settings">${esc(userName(me()))} さん</a>`;
}

function renderDemoBar() {
  const people = Object.entries(state.users)
    .map(([id, u]) => {
      const roles = state.trips
        .map((t) => {
          const m = membership(t, id);
          if (m) return `${t.title}の${m.role === "owner" ? "オーナー" : "メンバー"}`;
          if (t.joinRequests.some((r) => r.userId === id)) return `${t.title}に申請中`;
          return null;
        })
        .filter(Boolean);
      const label = `${u.name}${u.deleted ? "(退会済み)" : ""}(${roles.join("・") || "どの旅にも未参加"})`;
      return `<option value="${id}" ${state.me === id ? "selected" : ""} ${u.deleted ? "disabled" : ""}>${esc(label)}</option>`;
    })
    .join("");
  const t1 = tripById("t1");
  $("#demo-bar").innerHTML = `
    <strong>プロトタイプ</strong>
    <span><label for="demo-user" style="display:inline;margin:0">表示する人:</label>
      <select id="demo-user" data-change="switch-user">
        ${people}
        <option value="" ${state.me ? "" : "selected"}>ログアウトした状態</option>
      </select></span>
    <button type="button" data-action="demo-remote">ほかの人の変更を受け取る</button>
    <span class="demo-links">
      ${t1?.invite ? `<a href="#/join/${esc(t1.invite.token)}">京都の招待リンク</a>` : ""}
      <a href="#/join/okinawa-expired">期限切れの招待リンク</a>
      ${t1?.publicToken ? `<a href="#/p/${esc(t1.publicToken)}">京都の公開しおり</a>` : ""}
    </span>
    <button type="button" class="link" data-action="demo-reset">データを初期化</button>`;
}

function applyTheme() {
  if (state.theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", state.theme);
}

// ------------------------------------------------------------------
// 各画面
// ------------------------------------------------------------------
function pageNotFound() {
  return {
    title: "見つかりません",
    narrow: true,
    html: `
      <h1>ページが見つかりません</h1>
      <p>URL が間違っているか、ページが削除された、またはリンクの有効期限が切れた可能性があります。</p>
      <p class="small muted">(旅のメンバーでない場合も、旅があるかどうかがわからないよう、同じ表示になります)</p>
      <p><a class="button primary" href="#/">トップへ戻る</a></p>`,
  };
}

function errorsBox(id = "form-errors") {
  return `<div class="errors" id="${id}" role="alert" tabindex="-1"></div>`;
}
function showErrors(form, messages, id = "form-errors") {
  const box = form.querySelector(`#${id}`) ?? $(`#${id}`);
  box.innerHTML = messages.length
    ? `<ul>${messages.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>`
    : "";
  if (messages.length) box.focus();
  return messages.length === 0;
}

function pageLogin() {
  return {
    title: "ログイン",
    narrow: true,
    html: `
      <h1>ログイン</h1>
      <p class="notice small">プロトタイプでは、どのメールアドレスでも「たろう」としてログインします。ほかの人で試すときは、上の「表示する人」で切り替えてください。</p>
      <form data-form="login" novalidate>
        ${errorsBox()}
        <label for="login-email">メールアドレス</label>
        <input id="login-email" name="email" type="email" autocomplete="email" required>
        <label for="login-password">パスワード</label>
        <input id="login-password" name="password" type="password" autocomplete="current-password" required>
        <div class="actions"><button class="primary" type="submit">ログイン</button></div>
      </form>
      <p><a href="#/password-reset">パスワードを忘れたとき</a></p>
      <p>はじめての方は <a href="#/signup">会員登録</a></p>`,
  };
}

function pageSignup() {
  return {
    title: "会員登録",
    narrow: true,
    html: `
      <h1>会員登録</h1>
      <form data-form="signup" novalidate>
        ${errorsBox()}
        <label for="su-name">表示名 <span class="hint">旅のメンバーに見える名前。20 文字まで</span></label>
        <input id="su-name" name="name" type="text" maxlength="20" autocomplete="nickname" required>
        <label for="su-email">メールアドレス</label>
        <input id="su-email" name="email" type="email" autocomplete="email" required>
        <label for="su-password">パスワード <span class="hint">8 文字以上</span></label>
        <input id="su-password" name="password" type="password" autocomplete="new-password" required>
        <div class="actions"><button class="primary" type="submit">確認コードを送る</button></div>
      </form>
      <p>登録済みの方は <a href="#/login">ログイン</a></p>`,
  };
}

function pageSignupConfirm() {
  if (!ui.signupDraft) return { redirect: "#/signup" };
  return {
    title: "確認コードの入力",
    narrow: true,
    html: `
      <h1>確認コードの入力</h1>
      <p>${esc(ui.signupDraft.email)} に 6 けたの確認コードを送りました。</p>
      <p class="notice small">プロトタイプでは、どの 6 けたの数字でも登録できます。</p>
      <form data-form="signup-confirm" novalidate>
        ${errorsBox()}
        <label for="code">確認コード</label>
        <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required>
        <div class="actions">
          <button class="primary" type="submit">登録する</button>
          <button type="button" data-action="toast" data-message="確認コードを送り直しました">コードを送り直す</button>
        </div>
      </form>`,
  };
}

function pagePasswordReset() {
  return {
    title: "パスワードの再設定",
    narrow: true,
    html: `
      <h1>パスワードの再設定</h1>
      <form data-form="password-reset" novalidate>
        ${errorsBox()}
        <label for="pr-email">登録したメールアドレス</label>
        <input id="pr-email" name="email" type="email" autocomplete="email" required>
        <label for="pr-code">確認コード <span class="hint">メールで届いた 6 けたの数字(プロトタイプでは何でも可)</span></label>
        <input id="pr-code" name="code" type="text" inputmode="numeric" maxlength="6">
        <label for="pr-password">新しいパスワード <span class="hint">8 文字以上</span></label>
        <input id="pr-password" name="password" type="password" autocomplete="new-password">
        <div class="actions"><button class="primary" type="submit">パスワードを変更する</button></div>
      </form>`,
  };
}

function pageTrips() {
  const trips = myTrips();
  const pending = state.trips.filter((t) => t.joinRequests.some((r) => r.userId === me()));
  const cards = trips
    .map((t) => {
      const m = membership(t);
      return `<li class="card trip-card">
        <a href="#/trips/${esc(t.id)}">${esc(t.title)}</a>
        ${m.role === "owner" ? '<span class="badge owner">オーナー</span>' : ""}
        <div>${esc(fmtRange(t))}(${tripDays(t)}日間)</div>
        <div class="muted small">${t.destination ? `行き先: ${esc(t.destination)} ・ ` : ""}メンバー ${t.members.length} 人 ・ 予定 ${t.items.length} 件</div>
      </li>`;
    })
    .join("");
  return {
    title: "旅の一覧",
    html: `
      <div class="trip-head"><h1>旅の一覧</h1><a class="button primary" href="#/trips/new">+ 旅を作る</a></div>
      ${trips.length ? `<ul class="trip-list">${cards}</ul>` : `<p class="empty">まだ旅がありません。「旅を作る」から始めるか、招待リンクから参加を申請してください。</p>`}
      ${
        pending.length
          ? `<h2>承認待ちの旅</h2><ul>${pending.map((t) => `<li>${esc(t.title)} <span class="badge pending">オーナーの承認待ち</span></li>`).join("")}</ul>`
          : ""
      }`,
  };
}

function tripForm(trip, { disabled = false } = {}) {
  const v = trip ?? { title: "", startDate: "", endDate: "", destination: "" };
  const dis = disabled ? "disabled" : "";
  return `
    ${errorsBox()}
    <label for="tf-title">タイトル <span class="hint">50 文字まで</span></label>
    <input id="tf-title" name="title" type="text" maxlength="50" value="${esc(v.title)}" required ${dis}>
    <div class="field-row">
      <div><label for="tf-start">開始日</label><input id="tf-start" name="startDate" type="date" value="${esc(v.startDate)}" required ${dis}></div>
      <div><label for="tf-end">終了日 <span class="hint">${MAX_TRIP_DAYS} 日間まで</span></label><input id="tf-end" name="endDate" type="date" value="${esc(v.endDate)}" required ${dis}></div>
    </div>
    <label for="tf-dest">行き先 <span class="hint">省略できます。50 文字まで</span></label>
    <input id="tf-dest" name="destination" type="text" maxlength="50" value="${esc(v.destination)}" ${dis}>`;
}

function validateTrip(fd) {
  const title = String(fd.get("title") ?? "").trim();
  const startDate = String(fd.get("startDate") ?? "");
  const endDate = String(fd.get("endDate") ?? "");
  const destination = String(fd.get("destination") ?? "").trim();
  const errors = [];
  if (!title) errors.push("タイトルを入力してください");
  if (title.length > 50) errors.push("タイトルは 50 文字までです");
  if (!startDate || !endDate) errors.push("開始日と終了日を選んでください");
  else if (endDate < startDate) errors.push("終了日は開始日以降にしてください");
  else if (tripDays({ startDate, endDate }) > MAX_TRIP_DAYS)
    errors.push(`旅の日数は ${MAX_TRIP_DAYS} 日までです`);
  if (destination.length > 50) errors.push("行き先は 50 文字までです");
  return { errors, value: { title, startDate, endDate, destination } };
}

function pageNewTrip() {
  return {
    title: "旅を作る",
    narrow: true,
    html: `
      <h1>旅を作る</h1>
      <form data-form="new-trip" novalidate>
        ${tripForm(null)}
        <div class="actions">
          <button class="primary" type="submit">作る</button>
          <a class="button" href="#/trips">やめる</a>
        </div>
      </form>`,
  };
}

// ---- 旅の画面 ----
function pageTrip(trip, tab) {
  const owner = isOwner(trip);
  const pendingCount = trip.joinRequests.length;
  const tabs = [
    ["plan", "旅程"],
    ["ideas", "候補"],
    ["money", "割り勘"],
    ["members", "メンバー"],
  ];
  const others = trip.members.filter((m) => m.userId !== me()).slice(0, 1);
  const viewers = [me(), ...others.map((m) => m.userId)];
  const tabHtml = tabs
    .map(
      ([key, label]) =>
        `<a href="#/trips/${esc(trip.id)}${key === "plan" ? "" : `?tab=${key}`}" ${tab === key ? 'aria-current="page"' : ""}>${label}${
          key === "members" && owner && pendingCount
            ? `<span class="count" aria-label="未処理の参加申請 ${pendingCount} 件">${pendingCount}</span>`
            : ""
        }</a>`,
    )
    .join("");

  let content = "";
  if (tab === "ideas") content = tabIdeas(trip);
  else if (tab === "money") content = tabMoney(trip);
  else if (tab === "members") content = tabMembers(trip);
  else content = tabPlan(trip);

  return {
    title: trip.title,
    html: `
      <div class="trip-head">
        <h1>${esc(trip.title)}</h1>
        <span>${esc(fmtRange(trip))}${trip.destination ? ` ・ ${esc(trip.destination)}` : ""}</span>
        <a href="#/trips/${esc(trip.id)}/settings" class="small">旅の設定</a>
      </div>
      <p class="presence">
        <span>今見ている人:</span>
        ${viewers.map((id) => `<span class="avatar" title="${esc(userName(id))}" aria-hidden="true">${esc(userName(id).slice(0, 1))}</span>`).join("")}
        <span>${viewers.map((id) => esc(userName(id))).join("、")}</span>
      </p>
      <nav class="tabs" aria-label="旅の画面の切り替え">${tabHtml}</nav>
      ${content}`,
  };
}

function tabPlan(trip) {
  const days = tripDays(trip);
  if (ui.mapDay > days) ui.mapDay = 1;
  const dayBlocks = [];
  for (let d = 1; d <= days; d++) {
    const items = itemsOfDay(trip, d);
    let pinNo = 0;
    let prevPlace = null;
    const lis = items
      .map((it, idx) => {
        const leg =
          it.place && prevPlace
            ? `<div class="leg" aria-hidden="false">↓ ${MODES[ui.mapMode]}で${fmtMinutes(legMinutes(prevPlace, it.place, ui.mapMode))}</div>`
            : "";
        if (it.place) {
          pinNo += 1;
          prevPlace = it.place;
        }
        const editing =
          ui.remoteEditing?.tripId === trip.id && ui.remoteEditing.itemId === it.id
            ? `<span class="editing-badge">✎ ${esc(userName(ui.remoteEditing.userId))}さんが編集中</span>`
            : "";
        const isFirst = d === 1 && idx === 0;
        const isLast = d === days && idx === items.length - 1;
        const gmaps = it.place
          ? `<a class="small" href="https://www.google.com/maps/search/?api=1&query=${it.place.lat},${it.place.lng}" target="_blank" rel="noopener">Google マップで開く<span class="visually-hidden">(${esc(it.title)}、新しいタブ)</span></a>`
          : "";
        return `${leg}<li class="item" id="item-${esc(it.id)}">
          <div class="item-main">
            <span>${it.place ? `<span class="pin-no" aria-label="地図の ${pinNo} 番">${pinNo}</span>` : ""}</span>
            <span class="item-time">${esc(it.time || "--:--")}</span>
            <div>
              <div class="item-title">${esc(it.title)}</div>
              ${it.place ? `<div class="item-place">場所: ${esc(it.place.name)}</div>` : ""}
              ${editing}
            </div>
          </div>
          <div class="item-tools">
            <button type="button" class="small" data-action="item-edit" data-id="${esc(it.id)}">編集<span class="visually-hidden">: ${esc(it.title)}</span></button>
            <button type="button" class="small" data-action="item-move" data-id="${esc(it.id)}" data-dir="-1" ${isFirst ? "disabled" : ""} aria-label="「${esc(it.title)}」を上へ">↑</button>
            <button type="button" class="small" data-action="item-move" data-id="${esc(it.id)}" data-dir="1" ${isLast ? "disabled" : ""} aria-label="「${esc(it.title)}」を下へ">↓</button>
            <button type="button" class="small danger" data-action="item-delete" data-id="${esc(it.id)}">削除<span class="visually-hidden">: ${esc(it.title)}</span></button>
            ${gmaps}
          </div>
          <details>
            <summary>メモとコメント(${it.comments.length})</summary>
            ${it.memo ? `<p class="memo">${esc(it.memo)}</p>` : '<p class="muted small">メモはありません</p>'}
            <ul class="comments">
              ${it.comments
                .map(
                  (
                    c,
                  ) => `<li><strong>${esc(userName(c.userId))}</strong> <span class="muted small">${esc(fmtDateTime(c.createdAt))}</span>
                  ${c.userId === me() ? `<button type="button" class="link small" data-action="comment-delete" data-id="${esc(it.id)}" data-comment="${esc(c.id)}">削除</button>` : ""}
                  <div class="memo">${esc(c.body)}</div></li>`,
                )
                .join("")}
            </ul>
            <form data-form="comment" data-id="${esc(it.id)}" novalidate>
              <label for="cm-${esc(it.id)}">コメント <span class="hint">200 文字まで</span></label>
              <div class="invite-box">
                <input id="cm-${esc(it.id)}" name="body" type="text" maxlength="200">
                <button type="submit" class="small">送る</button>
              </div>
            </form>
            <p class="small muted">最終更新: ${esc(userName(it.updatedBy))}(${esc(fmtDateTime(it.updatedAt))}、版 ${it.version})</p>
          </details>
        </li>`;
      })
      .join("");
    dayBlocks.push(`
      <section class="day" aria-labelledby="day-${d}">
        <div class="day-head">
          <h2 id="day-${d}">${d}日目 <span class="muted small">${esc(fmtDay(dateOf(trip.startDate, d - 1)))}</span></h2>
          <button type="button" class="small" data-action="item-add" data-day="${d}">+ 予定を追加<span class="visually-hidden">(${d}日目)</span></button>
        </div>
        ${items.length ? `<ol class="items">${lis}</ol>` : '<p class="empty small">予定はまだありません</p>'}
      </section>`);
  }

  return `
    <div class="view-switch" role="group" aria-label="表示の切り替え">
      <button type="button" data-action="mobile-view" data-view="list" aria-pressed="${ui.mobileView === "list"}">一覧</button>
      <button type="button" data-action="mobile-view" data-view="map" aria-pressed="${ui.mobileView === "map"}">地図</button>
    </div>
    <div class="plan-layout" data-view="${ui.mobileView}">
      <div class="plan-list">${dayBlocks.join("")}</div>
      ${renderMap(trip, ui.mapDay)}
    </div>`;
}

function tabIdeas(trip) {
  const max = Math.max(1, ...trip.ideas.map((i) => i.votes.length));
  const ideas = [...trip.ideas].sort((a, b) => b.votes.length - a.votes.length);
  const rows = ideas
    .map((idea) => {
      const voted = idea.votes.includes(me());
      const adopted = idea.adoptedItemId
        ? trip.items.find((i) => i.id === idea.adoptedItemId)
        : null;
      return `<li class="row">
        <div class="grow">
          <strong>${esc(idea.name)}</strong> ${adopted ? `<span class="badge owner">旅程に入れました(${adopted.day}日目)</span>` : ""}
          ${idea.note ? `<div>${esc(idea.note)}</div>` : ""}
          <div class="muted small">提案: ${esc(userName(idea.createdBy))}${idea.votes.length ? ` ・ 投票した人: ${idea.votes.map((v) => esc(userName(v))).join("、")}` : ""}</div>
          <div class="bar" aria-hidden="true"><span style="width:${(idea.votes.length / max) * 100}%"></span></div>
        </div>
        <span class="votes">${idea.votes.length} 票</span>
        <button type="button" class="small" data-action="idea-vote" data-id="${esc(idea.id)}" aria-pressed="${voted}">${voted ? "投票済み(取り消す)" : "行きたい!"}<span class="visually-hidden">: ${esc(idea.name)}</span></button>
        ${adopted ? "" : `<button type="button" class="small" data-action="idea-adopt" data-id="${esc(idea.id)}">旅程に入れる<span class="visually-hidden">: ${esc(idea.name)}</span></button>`}
      </li>`;
    })
    .join("");
  return `
    <div class="two-col">
      <section aria-labelledby="ideas-title">
        <h2 id="ideas-title">行きたい場所の候補</h2>
        ${ideas.length ? `<ul class="list-plain">${rows}</ul>` : '<p class="empty">まだ候補がありません</p>'}
      </section>
      <section class="card" aria-labelledby="idea-form-title">
        <h2 id="idea-form-title" style="margin-top:0">候補を出す</h2>
        <form data-form="idea" novalidate>
          ${errorsBox("idea-errors")}
          <label for="idea-name">場所 <span class="hint">一覧から選ぶと地図に出せます</span></label>
          <input id="idea-name" name="name" type="text" list="place-names" maxlength="100" autocomplete="off">
          <datalist id="place-names">${PLACES.map((p) => `<option value="${esc(p.name)}"></option>`).join("")}</datalist>
          <label for="idea-note">ひとこと <span class="hint">省略できます。100 文字まで</span></label>
          <input id="idea-note" name="note" type="text" maxlength="100">
          <div class="actions"><button type="submit" class="primary">候補に出す</button></div>
        </form>
      </section>
    </div>`;
}

function tabMoney(trip) {
  const { transfers, balances } = settle(trip.expenses);
  const paid = new Map();
  for (const e of trip.expenses) paid.set(e.paidBy, (paid.get(e.paidBy) ?? 0) + e.amount);
  const total = trip.expenses.reduce((s, e) => s + e.amount, 0);
  const people = [...new Set([...trip.members.map((m) => m.userId), ...balances.keys()])];
  const rows = trip.expenses
    .map(
      (e) => `<tr>
        <td>${esc(e.title)}<div class="muted small">${e.splitWith.map((u) => esc(userName(u))).join("・")}で割る</div></td>
        <td>${esc(userName(e.paidBy))}</td>
        <td class="money">${yen(e.amount)}</td>
        <td><button type="button" class="small danger" data-action="expense-delete" data-id="${esc(e.id)}">削除<span class="visually-hidden">: ${esc(e.title)}</span></button></td>
      </tr>`,
    )
    .join("");
  return `
    <div class="two-col">
      <section aria-labelledby="exp-title">
        <h2 id="exp-title">支出(合計 ${yen(total)})</h2>
        ${
          trip.expenses.length
            ? `<table><thead><tr><th scope="col">内容</th><th scope="col">払った人</th><th scope="col" class="money">金額</th><th scope="col"><span class="visually-hidden">操作</span></th></tr></thead><tbody>${rows}</tbody></table>`
            : '<p class="empty">まだ支出がありません</p>'
        }
        <h2>支出を記録する</h2>
        <form data-form="expense" class="card" novalidate>
          ${errorsBox("exp-errors")}
          <label for="ex-title">内容 <span class="hint">50 文字まで</span></label>
          <input id="ex-title" name="title" type="text" maxlength="50">
          <div class="field-row">
            <div><label for="ex-amount">金額(円)</label><input id="ex-amount" name="amount" type="number" inputmode="numeric" min="1" step="1"></div>
            <div><label for="ex-paid">払った人</label><select id="ex-paid" name="paidBy">${trip.members
              .map(
                (m) =>
                  `<option value="${esc(m.userId)}" ${m.userId === me() ? "selected" : ""}>${esc(userName(m.userId))}</option>`,
              )
              .join("")}</select></div>
          </div>
          <fieldset><legend>分け合う人</legend>
            ${trip.members.map((m) => `<label class="check"><input type="checkbox" name="splitWith" value="${esc(m.userId)}" checked> ${esc(userName(m.userId))}</label>`).join("")}
          </fieldset>
          <div class="actions"><button type="submit" class="primary">記録する</button></div>
        </form>
      </section>
      <section class="card" aria-labelledby="settle-title">
        <h2 id="settle-title" style="margin-top:0">精算</h2>
        ${
          transfers.length
            ? `<ul class="list-plain">${transfers.map((t) => `<li class="row"><span class="grow"><strong>${esc(userName(t.from))}</strong> → <strong>${esc(userName(t.to))}</strong></span><span class="money">${yen(t.amount)}</span></li>`).join("")}</ul>
               <p class="small muted">送金は ${transfers.length} 回です(なるべく少なくなるように組み合わせています)。</p>`
            : "<p>精算は必要ありません。</p>"
        }
        <h3>一人ずつの内訳</h3>
        <table>
          <thead><tr><th scope="col">名前</th><th scope="col" class="money">立て替え</th><th scope="col" class="money">差し引き</th></tr></thead>
          <tbody>${people
            .map((id) => {
              const b = balances.get(id) ?? 0;
              return `<tr><td>${esc(userName(id))}</td><td class="money">${yen(paid.get(id) ?? 0)}</td><td class="money">${b > 0 ? `受け取る ${yen(b)}` : b < 0 ? `払う ${yen(-b)}` : "0 円"}</td></tr>`;
            })
            .join("")}</tbody>
        </table>
        <p class="small muted">1 人あたりの額は 1 円未満を切り捨て、端数は払った人の負担にしています。</p>
      </section>
    </div>`;
}

function tabMembers(trip) {
  const owner = isOwner(trip);
  const members = [...trip.members].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  let invite = "";
  if (trip.invite) {
    const expired = !inviteValid(trip);
    invite = `
      <div class="invite-box">
        <label for="invite-url" class="visually-hidden">招待リンク</label>
        <input id="invite-url" type="text" readonly value="${esc(inviteUrl(trip.invite.token))}">
        <button type="button" data-action="copy" data-target="invite-url" ${expired ? "disabled" : ""}>コピー</button>
      </div>
      <p class="${expired ? "notice warn" : "small muted"}">${
        expired
          ? `このリンクは期限が切れています(${esc(fmtDateTime(trip.invite.expiresAt))}まで)。${owner ? "「発行し直す」で新しいリンクを作れます。" : "オーナーに新しいリンクを頼んでください。"}`
          : `${esc(fmtDateTime(trip.invite.expiresAt))} まで有効。リンクを開いた人は参加を申請し、オーナーが承認するとメンバーになります。`
      }</p>`;
  } else {
    invite = `<p class="notice warn">招待リンクは止められています。${owner ? "" : "オーナーに頼んでください。"}</p>`;
  }
  const ownerTools = owner
    ? `<div class="actions">
        <button type="button" data-action="invite-reissue">${trip.invite ? "リンクを発行し直す" : "リンクを発行する"}</button>
        ${trip.invite ? '<button type="button" class="danger" data-action="invite-stop">リンクを止める</button>' : ""}
      </div>
      <p class="small muted">発行し直すと、前のリンクはすぐに使えなくなります。</p>`
    : "";

  const requests = owner
    ? `<section class="card" aria-labelledby="req-title">
        <h2 id="req-title" style="margin-top:0">参加申請(${trip.joinRequests.length} 件)</h2>
        ${
          trip.joinRequests.length
            ? `<ul class="list-plain">${trip.joinRequests
                .map(
                  (
                    r,
                  ) => `<li class="row"><span class="grow"><strong>${esc(userName(r.userId))}</strong><div class="muted small">${esc(fmtDateTime(r.requestedAt))} に申請</div></span>
                    <button type="button" class="small primary" data-action="req-approve" data-id="${esc(r.userId)}">承認<span class="visually-hidden">: ${esc(userName(r.userId))}</span></button>
                    <button type="button" class="small danger" data-action="req-reject" data-id="${esc(r.userId)}">却下<span class="visually-hidden">: ${esc(userName(r.userId))}</span></button></li>`,
                )
                .join("")}</ul>`
            : '<p class="muted">未処理の申請はありません。</p>'
        }
        <p class="small muted">承認するまで、申請した人はしおりを見られません。メンバーは ${MAX_MEMBERS} 人までです(今 ${trip.members.length} 人)。</p>
      </section>`
    : `<p class="small muted">参加申請は、オーナー(${esc(userName(trip.ownerId))}さん)が承認します。</p>`;

  return `
    <div class="two-col">
      <section aria-labelledby="mem-title">
        <h2 id="mem-title">メンバー(${trip.members.length} 人)</h2>
        <ul class="list-plain">${members
          .map(
            (
              m,
            ) => `<li class="row"><span class="avatar" aria-hidden="true">${esc(userName(m.userId).slice(0, 1))}</span>
              <span class="grow">${esc(userName(m.userId))}${m.userId === me() ? "(あなた)" : ""}</span>
              ${m.role === "owner" ? '<span class="badge owner">オーナー</span>' : ""}</li>`,
          )
          .join("")}</ul>
        <h2>招待リンク</h2>
        ${invite}
        ${ownerTools}
      </section>
      ${requests}
    </div>`;
}

// ---- 旅の設定 ----
function pageTripSettings(trip) {
  const owner = isOwner(trip);
  const others = trip.members.filter((m) => m.userId !== me());
  return {
    title: `${trip.title} の設定`,
    narrow: true,
    html: `
      <p><a href="#/trips/${esc(trip.id)}">← ${esc(trip.title)} に戻る</a></p>
      <h1>旅の設定</h1>
      <section>
        <h2>旅の情報</h2>
        ${owner ? "" : '<p class="small muted">旅の情報を変えられるのはオーナーだけです。</p>'}
        <form data-form="edit-trip" data-id="${esc(trip.id)}" novalidate>
          ${tripForm(trip, { disabled: !owner })}
          ${owner ? '<div class="actions"><button type="submit" class="primary">保存する</button></div>' : ""}
        </form>
      </section>
      <section>
        <h2>公開しおり</h2>
        <p>リンクを知っている人なら、ログインしなくても旅程・地図・メンバーの表示名を見られます。割り勘とコメントは見えません。</p>
        ${
          trip.publicToken
            ? `<div class="invite-box"><label for="public-url" class="visually-hidden">公開リンク</label><input id="public-url" type="text" readonly value="${esc(publicUrl(trip.publicToken))}"><button type="button" data-action="copy" data-target="public-url">コピー</button></div>
               <p><a href="#/p/${esc(trip.publicToken)}">公開しおりを見る</a></p>`
            : '<p class="muted">公開していません。</p>'
        }
        ${
          owner
            ? `<div class="actions">${
                trip.publicToken
                  ? '<button type="button" class="danger" data-action="public-stop">公開を止める</button>'
                  : '<button type="button" data-action="public-issue">公開リンクを発行する</button>'
              }</div>`
            : ""
        }
      </section>
      ${
        owner
          ? `<section>
              <h2>メンバーの管理</h2>
              ${
                others.length
                  ? `<ul class="list-plain">${others
                      .map(
                        (m) =>
                          `<li class="row"><span class="grow">${esc(userName(m.userId))}</span><button type="button" class="small danger" data-action="member-remove" data-id="${esc(m.userId)}">外す<span class="visually-hidden">: ${esc(userName(m.userId))}</span></button></li>`,
                      )
                      .join("")}</ul>
                     <form data-form="transfer" novalidate>
                       <label for="transfer-to">オーナーを引き継ぐ</label>
                       <div class="invite-box">
                         <select id="transfer-to" name="to">${others.map((m) => `<option value="${esc(m.userId)}">${esc(userName(m.userId))}</option>`).join("")}</select>
                         <button type="submit">引き継ぐ</button>
                       </div>
                       <p class="small muted">引き継ぐと、あなたはメンバーになります。</p>
                     </form>`
                  : '<p class="muted">ほかのメンバーはいません。</p>'
              }
            </section>`
          : ""
      }
      <section>
        <h2>旅から抜ける・旅を消す</h2>
        ${
          owner
            ? `<p class="small muted">オーナーは、先にオーナーを引き継いでから抜けられます。</p>
               <div class="actions"><button type="button" class="danger filled" data-action="trip-delete">この旅を削除する</button></div>`
            : '<div class="actions"><button type="button" class="danger" data-action="trip-leave">この旅から抜ける</button></div>'
        }
      </section>`,
  };
}

// ---- 招待リンク ----
function pageJoin(token) {
  const trip = state.trips.find((t) => t.invite?.token === token);
  // 期限切れ・止めたリンク・存在しないリンクは、どれも同じ「見つかりません」
  if (!trip || !inviteValid(trip)) return pageNotFound();
  const member = membership(trip);
  const pending = trip.joinRequests.some((r) => r.userId === me());
  let body;
  if (member) {
    body = `<p class="notice">あなたはこの旅のメンバーです。</p><p><a class="button primary" href="#/trips/${esc(trip.id)}">旅を開く</a></p>`;
  } else if (pending) {
    body = `<p class="notice warn">参加を申請しました。オーナーが承認すると、しおりを見られるようになります。</p>
            <p class="small muted">プロトタイプでは、上の「表示する人」をオーナー(たろう)に切り替えて、メンバータブから承認できます。</p>`;
  } else {
    body = `<p>この旅に参加するには、オーナーの承認が必要です。</p>
            <div class="actions"><button type="button" class="primary" data-action="join-request" data-token="${esc(token)}">参加を申請する</button></div>`;
  }
  return {
    title: "旅への招待",
    narrow: true,
    html: `
      <h1>旅への招待</h1>
      <div class="card">
        <p style="font-size:1.2rem;margin:0"><strong>${esc(trip.title)}</strong></p>
        <p class="muted" style="margin:0">メンバー ${trip.members.length} 人</p>
      </div>
      <p class="small muted">承認されるまでは、旅の日程や予定などは表示されません。</p>
      ${body}`,
  };
}

// ---- 公開しおり ----
function pagePublic(token) {
  const trip = state.trips.find((t) => t.publicToken === token);
  if (!trip) return pageNotFound();
  const days = tripDays(trip);
  if (ui.mapDay > days) ui.mapDay = 1;
  const blocks = [];
  for (let d = 1; d <= days; d++) {
    const items = itemsOfDay(trip, d);
    blocks.push(`<section class="day"><div class="day-head"><h2>${d}日目 <span class="muted small">${esc(fmtDay(dateOf(trip.startDate, d - 1)))}</span></h2></div>
      ${
        items.length
          ? `<ol class="items">${items
              .map(
                (
                  it,
                ) => `<li class="item"><div class="item-main"><span></span><span class="item-time">${esc(it.time || "--:--")}</span>
                  <div><div class="item-title">${esc(it.title)}</div>${it.place ? `<div class="item-place">場所: ${esc(it.place.name)}</div>` : ""}${it.memo ? `<div class="memo small">${esc(it.memo)}</div>` : ""}</div></div></li>`,
              )
              .join("")}</ol>`
          : '<p class="empty small">予定はありません</p>'
      }</section>`);
  }
  return {
    title: `${trip.title}(公開しおり)`,
    html: `
      <p class="notice small">これは公開しおりです(読み取り専用)。割り勘とコメントは表示されません。</p>
      <div class="trip-head"><h1>${esc(trip.title)}</h1><span>${esc(fmtRange(trip))}</span></div>
      <p>メンバー: ${trip.members.map((m) => esc(userName(m.userId))).join("、")}</p>
      <div class="view-switch" role="group" aria-label="表示の切り替え">
        <button type="button" data-action="mobile-view" data-view="list" aria-pressed="${ui.mobileView === "list"}">一覧</button>
        <button type="button" data-action="mobile-view" data-view="map" aria-pressed="${ui.mobileView === "map"}">地図</button>
      </div>
      <div class="plan-layout" data-view="${ui.mobileView}">
        <div class="plan-list">${blocks.join("")}</div>
        ${renderMap(trip, ui.mapDay)}
      </div>`,
  };
}

// ---- アカウント設定 ----
function pageSettings() {
  const themes = { system: "端末に合わせる", light: "ライト", dark: "ダーク" };
  return {
    title: "アカウント設定",
    narrow: true,
    html: `
      <h1>アカウント設定</h1>
      <form data-form="profile" novalidate>
        ${errorsBox()}
        <label for="pf-name">表示名 <span class="hint">20 文字まで</span></label>
        <input id="pf-name" name="name" type="text" maxlength="20" value="${esc(userName(me()))}">
        <div class="actions"><button type="submit" class="primary">保存する</button></div>
      </form>
      <fieldset>
        <legend>画面の色</legend>
        ${Object.entries(themes)
          .map(
            ([k, v]) =>
              `<label class="check"><input type="radio" name="theme" value="${k}" data-change="theme" ${state.theme === k ? "checked" : ""}> ${v}</label>`,
          )
          .join("")}
      </fieldset>
      <div class="actions">
        <button type="button" data-action="logout">ログアウト</button>
        <button type="button" class="danger" data-action="withdraw">退会する</button>
      </div>`,
  };
}

// ------------------------------------------------------------------
// お知らせ・ダイアログ
// ------------------------------------------------------------------
function toast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  const area = $("#toasts");
  area.append(el);
  // 画面を覆わないよう、新しい 2 件だけを残す
  while (area.children.length > 2) area.firstElementChild.remove();
  setTimeout(() => el.remove(), 5000);
}

let dialogReturnFocus = null;
let dialogState = null;
function openDialog(html, after) {
  const dlg = $("#dialog");
  dialogReturnFocus = document.activeElement;
  dlg.innerHTML = `<div class="dialog-body">${html}</div>`;
  if (!dlg.open) dlg.showModal();
  after?.(dlg);
  ($("[autofocus]", dlg) ?? $("input, select, textarea, button", dlg))?.focus();
}
function closeDialog() {
  const dlg = $("#dialog");
  if (dlg.open) dlg.close();
}
$("#dialog").addEventListener("close", () => {
  dialogState = null;
  if (dialogReturnFocus?.isConnected) dialogReturnFocus.focus();
});

function confirmDialog({ title, message, ok, danger = true }, onOk) {
  openDialog(
    `<h2 id="dialog-title">${esc(title)}</h2>
     <p>${esc(message)}</p>
     <div class="actions">
       <button type="button" class="${danger ? "danger filled" : "primary"}" data-action="dialog-ok">${esc(ok)}</button>
       <button type="button" data-action="dialog-cancel" autofocus>やめる</button>
     </div>`,
  );
  dialogState = { onOk };
}

// ---- 予定の編集ダイアログ(場所の検索つき) ----
function openItemDialog(trip, { item = null, day = 1, draft = null } = {}) {
  const v = draft ?? item ?? { day, time: "", title: "", place: null, memo: "" };
  const days = tripDays(trip);
  const editing =
    item && ui.remoteEditing?.tripId === trip.id && ui.remoteEditing.itemId === item.id
      ? `<p class="notice warn">${esc(userName(ui.remoteEditing.userId))}さんもこの予定を編集中です。あとから保存した人には、どちらの内容にするかの確認が出ます。</p>`
      : "";
  openDialog(
    `<h2 id="dialog-title">${item ? "予定を編集" : "予定を追加"}</h2>
     ${editing}
     <form data-form="item" novalidate>
       ${errorsBox("item-errors")}
       <div class="field-row">
         <div><label for="it-day">日にち</label>
           <select id="it-day" name="day">${Array.from({ length: days }, (_, i) => i + 1)
             .map(
               (d) =>
                 `<option value="${d}" ${d === v.day ? "selected" : ""}>${d}日目 ${esc(fmtDay(dateOf(trip.startDate, d - 1)))}</option>`,
             )
             .join("")}</select></div>
         <div><label for="it-time">時刻 <span class="hint">省略できます</span></label>
           <input id="it-time" name="time" type="time" value="${esc(v.time)}"></div>
       </div>
       <label for="it-title">タイトル <span class="hint">100 文字まで</span></label>
       <input id="it-title" name="title" type="text" maxlength="100" value="${esc(v.title)}" autofocus>
       <label for="it-place">場所 <span class="hint">地名を入れると候補が出ます(本番は Google の場所検索)</span></label>
       <input id="it-place" type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="place-list" autocomplete="off" value="${esc(v.place?.name ?? "")}">
       <ul id="place-list" class="suggestions" role="listbox" aria-label="場所の候補"></ul>
       <p id="place-chosen" class="small" aria-live="polite"></p>
       <label for="it-memo">メモ <span class="hint">1000 文字まで</span></label>
       <textarea id="it-memo" name="memo" maxlength="1000">${esc(v.memo)}</textarea>
       ${item ? `<p class="small muted">最終更新: ${esc(userName(item.updatedBy))}(${esc(fmtDateTime(item.updatedAt))}、版 ${item.version})</p>` : ""}
       <div class="actions">
         <button type="submit" class="primary">保存する</button>
         <button type="button" data-action="dialog-cancel">やめる</button>
       </div>
       ${
         item
           ? `<p class="small" style="margin-top:16px"><button type="button" class="link" data-action="demo-conflict">(デモ)今のうちに、ほかの人がこの予定を変更する</button></p>`
           : ""
       }
     </form>`,
    (dlg) => setupPlaceCombobox(dlg),
  );
  dialogState = {
    kind: "item",
    tripId: trip.id,
    itemId: item?.id ?? null,
    baseVersion: draft ? dialogState?.baseVersion : item?.version,
    place: v.place ?? null,
  };
  showChosenPlace();
}

function showChosenPlace() {
  const el = $("#place-chosen");
  if (!el || !dialogState) return;
  el.innerHTML = dialogState.place
    ? `地図に出す場所: <strong>${esc(dialogState.place.name)}</strong> <button type="button" class="link small" data-action="place-clear">外す</button>`
    : "場所は未設定です(地図には出ません)";
}

function setupPlaceCombobox(dlg) {
  const input = $("#it-place", dlg);
  const list = $("#place-list", dlg);
  let active = -1;
  let matches = [];
  const close = () => {
    list.innerHTML = "";
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  };
  const choose = (p) => {
    dialogState.place = { ...p };
    input.value = p.name;
    close();
    showChosenPlace();
  };
  const paint = () => {
    list.innerHTML = matches
      .map(
        (p, i) =>
          `<li id="opt-${i}" role="option" aria-selected="${i === active}" data-i="${i}">${esc(p.name)}</li>`,
      )
      .join("");
    input.setAttribute("aria-expanded", matches.length ? "true" : "false");
    if (active >= 0) input.setAttribute("aria-activedescendant", `opt-${active}`);
  };
  input.addEventListener("input", () => {
    const q = input.value.trim();
    matches = q ? PLACES.filter((p) => p.name.includes(q)).slice(0, 8) : [];
    active = -1;
    paint();
  });
  input.addEventListener("keydown", (e) => {
    if (!matches.length) return;
    if (e.key === "ArrowDown") {
      active = (active + 1) % matches.length;
      paint();
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      active = (active - 1 + matches.length) % matches.length;
      paint();
      e.preventDefault();
    } else if (e.key === "Enter" && active >= 0) {
      choose(matches[active]);
      e.preventDefault();
    } else if (e.key === "Escape") {
      close();
      e.stopPropagation();
      e.preventDefault();
    }
  });
  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li[data-i]");
    if (li) {
      choose(matches[Number(li.dataset.i)]);
      e.preventDefault();
    }
  });
}

// ---- 同時編集の衝突ダイアログ ----
function openConflictDialog(trip, current, draft) {
  const fields = [
    ["日にち", (v) => `${v.day}日目`],
    ["時刻", (v) => v.time || "なし"],
    ["タイトル", (v) => v.title],
    ["場所", (v) => v.place?.name ?? "なし"],
    ["メモ", (v) => v.memo || "なし"],
  ];
  const col = (title, v, other) => `
    <div class="card"><h3 style="margin-top:0">${title}</h3><dl>${fields
      .map(([label, f]) => {
        const changed = f(v) !== f(other);
        return `<dt>${label}${changed ? "(違い)" : ""}</dt><dd>${changed ? `<span class="changed">${esc(f(v))}</span>` : esc(f(v))}</dd>`;
      })
      .join("")}</dl></div>`;
  openDialog(
    `<h2 id="dialog-title">ほかの人が先に変更していました</h2>
     <p>${esc(userName(current.updatedBy))}さんが ${esc(fmtDateTime(current.updatedAt))} にこの予定を変更しました。どちらの内容にするか選んでください。</p>
     <div class="compare">
       ${col("あなたの内容", draft, current)}
       ${col(`今の内容(${esc(userName(current.updatedBy))}さん)`, current, draft)}
     </div>
     <div class="actions">
       <button type="button" class="primary" data-action="conflict-mine">あなたの内容で保存する</button>
       <button type="button" data-action="conflict-theirs">今の内容のままにする</button>
       <button type="button" data-action="conflict-reedit">今の内容をもとに編集し直す</button>
     </div>`,
  );
  dialogState = { kind: "conflict", tripId: trip.id, itemId: current.id, draft };
}

// ------------------------------------------------------------------
// 操作(ボタン)
// ------------------------------------------------------------------
function currentTrip() {
  const { seg } = parseRoute();
  return seg[0] === "trips" ? tripById(seg[1]) : null;
}

/** 本番ではサーバーが 403 を返す操作。画面にボタンを出さないうえで、念のためここでも確かめる */
function requireOwner(trip) {
  if (isOwner(trip)) return true;
  toast("この操作はオーナーだけができます");
  return false;
}

function touch(item) {
  item.version += 1;
  item.updatedBy = me();
  item.updatedAt = nowIso();
}

const actions = {
  toast: (el) => toast(el.dataset.message),
  "dialog-cancel": () => closeDialog(),
  "dialog-ok": () => {
    const fn = dialogState?.onOk;
    closeDialog();
    fn?.();
  },
  "map-day": (el) => {
    ui.mapDay = Number(el.dataset.day);
    render();
  },
  "map-mode": (el) => {
    ui.mapMode = el.dataset.mode;
    render();
  },
  "mobile-view": (el) => {
    ui.mobileView = el.dataset.view;
    render();
  },
  copy: async (el) => {
    const input = document.getElementById(el.dataset.target);
    try {
      await navigator.clipboard.writeText(input.value);
      toast("リンクをコピーしました");
    } catch {
      input.select();
      toast("リンクを選択しました。コピーしてください");
    }
  },

  // ---- 予定 ----
  "item-add": (el) => openItemDialog(currentTrip(), { day: Number(el.dataset.day) }),
  "item-edit": (el) => {
    const trip = currentTrip();
    openItemDialog(trip, { item: trip.items.find((i) => i.id === el.dataset.id) });
  },
  "item-move": (el) => {
    const trip = currentTrip();
    const item = trip.items.find((i) => i.id === el.dataset.id);
    const dir = Number(el.dataset.dir);
    const sameDay = itemsOfDay(trip, item.day);
    const pos = sameDay.indexOf(item);
    const from = trip.items.indexOf(item);
    trip.items.splice(from, 1);
    if ((dir < 0 && pos === 0) || (dir > 0 && pos === sameDay.length - 1)) {
      // 日の端では、前の日の最後・次の日の最初へ
      item.day += dir;
      const target = itemsOfDay(trip, item.day);
      const anchor = dir < 0 ? target.at(-1) : target[0];
      const at = anchor ? trip.items.indexOf(anchor) + (dir < 0 ? 1 : 0) : trip.items.length;
      trip.items.splice(at, 0, item);
    } else {
      const neighbor = sameDay[pos + dir];
      const at = trip.items.indexOf(neighbor) + (dir > 0 ? 1 : 0);
      trip.items.splice(at, 0, item);
    }
    touch(item);
    commit();
    // 動かしたボタンにフォーカスを戻す(キーボードで続けて動かせるように)
    const again = $(`[data-action="item-move"][data-id="${item.id}"][data-dir="${dir}"]`);
    (again && !again.disabled
      ? again
      : $(`[data-action="item-edit"][data-id="${item.id}"]`)
    )?.focus();
    toast(`「${item.title}」を ${item.day}日目の${dir < 0 ? "上" : "下"}へ動かしました`);
  },
  "item-delete": (el) => {
    const trip = currentTrip();
    const item = trip.items.find((i) => i.id === el.dataset.id);
    confirmDialog(
      {
        title: "予定を削除しますか?",
        message: `「${item.title}」とそのコメントを削除します。元に戻せません。`,
        ok: "削除する",
      },
      () => {
        trip.items = trip.items.filter((i) => i !== item);
        for (const idea of trip.ideas)
          if (idea.adoptedItemId === item.id) idea.adoptedItemId = null;
        commit();
        toast(`「${item.title}」を削除しました`);
      },
    );
  },
  "place-clear": () => {
    dialogState.place = null;
    $("#it-place").value = "";
    showChosenPlace();
  },
  "demo-conflict": () => {
    const trip = tripById(dialogState.tripId);
    const item = trip.items.find((i) => i.id === dialogState.itemId);
    const other = trip.members.find((m) => m.userId !== me())?.userId ?? me();
    item.memo = `${item.memo ? `${item.memo}\n` : ""}(${userName(other)}が追記)集合時間を 15 分早めます`;
    item.time = item.time || "09:00";
    item.version += 1;
    item.updatedBy = other;
    item.updatedAt = nowIso();
    save();
    toast(
      `デモ: ${userName(other)}さんが「${item.title}」を先に変更しました。このまま保存してみてください`,
    );
  },
  "conflict-mine": () => {
    const { tripId, itemId, draft } = dialogState;
    const trip = tripById(tripId);
    const item = trip.items.find((i) => i.id === itemId);
    if (!item) return toast("この予定はすでに削除されています");
    applyDraft(trip, item, draft);
    closeDialog();
    commit();
    toast("あなたの内容で保存しました");
  },
  "conflict-theirs": () => {
    closeDialog();
    render();
    toast("今の内容のままにしました");
  },
  "conflict-reedit": () => {
    const { tripId, itemId } = dialogState;
    const trip = tripById(tripId);
    openItemDialog(trip, { item: trip.items.find((i) => i.id === itemId) });
  },
  "comment-delete": (el) => {
    const trip = currentTrip();
    const item = trip.items.find((i) => i.id === el.dataset.id);
    item.comments = item.comments.filter(
      (c) => !(c.id === el.dataset.comment && c.userId === me()),
    );
    commit();
    toast("コメントを削除しました");
  },

  // ---- 候補 ----
  "idea-vote": (el) => {
    const idea = currentTrip().ideas.find((i) => i.id === el.dataset.id);
    idea.votes = idea.votes.includes(me())
      ? idea.votes.filter((v) => v !== me())
      : [...idea.votes, me()];
    commit();
    $(`[data-action="idea-vote"][data-id="${idea.id}"]`)?.focus();
  },
  "idea-adopt": (el) => {
    const trip = currentTrip();
    const idea = trip.ideas.find((i) => i.id === el.dataset.id);
    openDialog(
      `<h2 id="dialog-title">「${esc(idea.name)}」を旅程に入れる</h2>
       <form data-form="adopt" data-id="${esc(idea.id)}">
         <label for="adopt-day">どの日に入れますか(その日の最後に入ります)</label>
         <select id="adopt-day" name="day">${Array.from({ length: tripDays(trip) }, (_, i) => `<option value="${i + 1}">${i + 1}日目 ${esc(fmtDay(dateOf(trip.startDate, i)))}</option>`).join("")}</select>
         <div class="actions"><button type="submit" class="primary">旅程に入れる</button><button type="button" data-action="dialog-cancel">やめる</button></div>
       </form>`,
    );
  },

  // ---- 割り勘 ----
  "expense-delete": (el) => {
    const trip = currentTrip();
    const e = trip.expenses.find((x) => x.id === el.dataset.id);
    confirmDialog(
      {
        title: "支出を削除しますか?",
        message: `「${e.title}」(${yen(e.amount)})を削除します。`,
        ok: "削除する",
      },
      () => {
        trip.expenses = trip.expenses.filter((x) => x !== e);
        commit();
        toast("支出を削除しました");
      },
    );
  },

  // ---- 招待・申請 ----
  "invite-reissue": () => {
    const trip = currentTrip();
    if (!requireOwner(trip)) return;
    trip.invite = { token: newToken(), expiresAt: daysFromNow(INVITE_DAYS) };
    commit();
    toast("新しい招待リンクを発行しました。前のリンクは使えなくなりました");
  },
  "invite-stop": () => {
    const trip = currentTrip();
    if (!requireOwner(trip)) return;
    confirmDialog(
      {
        title: "招待リンクを止めますか?",
        message: "止めたリンクを開いた人には「見つかりません」と表示されます。",
        ok: "止める",
      },
      () => {
        trip.invite = null;
        commit();
        toast("招待リンクを止めました");
      },
    );
  },
  "join-request": (el) => {
    const trip = state.trips.find((t) => t.invite?.token === el.dataset.token);
    if (!trip || !inviteValid(trip)) return render();
    if (trip.joinRequests.length >= MAX_PENDING)
      return toast("この旅は申請が多いため、今は申請できません");
    if (!trip.joinRequests.some((r) => r.userId === me()))
      trip.joinRequests.push({ userId: me(), requestedAt: nowIso() });
    commit();
    toast("参加を申請しました");
  },
  "req-approve": (el) => {
    const trip = currentTrip();
    if (!requireOwner(trip)) return;
    if (trip.members.length >= MAX_MEMBERS) return toast(`メンバーは ${MAX_MEMBERS} 人までです`);
    const userId = el.dataset.id;
    trip.joinRequests = trip.joinRequests.filter((r) => r.userId !== userId);
    trip.members.push({ userId, role: "member", joinedAt: nowIso() });
    commit();
    toast(`${userName(userId)}さんの参加を承認しました`);
  },
  "req-reject": (el) => {
    const trip = currentTrip();
    if (!requireOwner(trip)) return;
    const userId = el.dataset.id;
    confirmDialog(
      {
        title: "申請を却下しますか?",
        message: `${userName(userId)}さんの参加申請を却下します。`,
        ok: "却下する",
      },
      () => {
        trip.joinRequests = trip.joinRequests.filter((r) => r.userId !== userId);
        commit();
        toast(`${userName(userId)}さんの申請を却下しました`);
      },
    );
  },

  // ---- 旅の設定 ----
  "public-issue": () => {
    const trip = currentTrip();
    if (!requireOwner(trip)) return;
    trip.publicToken = newToken();
    commit();
    toast("公開リンクを発行しました");
  },
  "public-stop": () => {
    const trip = currentTrip();
    if (!requireOwner(trip)) return;
    trip.publicToken = null;
    commit();
    toast("公開を止めました");
  },
  "member-remove": (el) => {
    const trip = currentTrip();
    if (!requireOwner(trip)) return;
    const userId = el.dataset.id;
    confirmDialog(
      {
        title: "メンバーを外しますか?",
        message: `${userName(userId)}さんは、この旅のしおりを見られなくなります。`,
        ok: "外す",
      },
      () => {
        trip.members = trip.members.filter((m) => m.userId !== userId);
        for (const idea of trip.ideas) idea.votes = idea.votes.filter((v) => v !== userId);
        commit();
        toast(`${userName(userId)}さんを外しました`);
      },
    );
  },
  "trip-leave": () => {
    const trip = currentTrip();
    confirmDialog(
      {
        title: "この旅から抜けますか?",
        message:
          "抜けると、この旅のしおりを見られなくなります。もう一度参加するには招待が必要です。",
        ok: "抜ける",
      },
      () => {
        trip.members = trip.members.filter((m) => m.userId !== me());
        save();
        go("#/trips");
        toast(`「${trip.title}」から抜けました`);
      },
    );
  },
  "trip-delete": () => {
    const trip = currentTrip();
    if (!requireOwner(trip)) return;
    confirmDialog(
      {
        title: "この旅を削除しますか?",
        message: `「${trip.title}」の予定・候補・割り勘・コメントがすべて消えます。元に戻せません。`,
        ok: "削除する",
      },
      () => {
        state.trips = state.trips.filter((t) => t !== trip);
        save();
        go("#/trips");
        toast(`「${trip.title}」を削除しました`);
      },
    );
  },

  // ---- アカウント ----
  logout: () => {
    state.me = null;
    save();
    go("#/login");
    toast("ログアウトしました");
  },
  withdraw: () => {
    confirmDialog(
      {
        title: "退会しますか?",
        message:
          "あなたがオーナーの旅は、いちばん早く参加したメンバーに引き継ぎます。メンバーがあなた 1 人だけの旅は残り、名前は「退会した会員」になります。元に戻せません。",
        ok: "退会する",
      },
      () => {
        const id = me();
        for (const t of state.trips) {
          const m = membership(t, id);
          if (m?.role === "owner") {
            const next = [...t.members]
              .filter((x) => x.userId !== id)
              .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))[0];
            if (next) {
              next.role = "owner";
              m.role = "member";
              t.ownerId = next.userId;
            }
          }
          t.joinRequests = t.joinRequests.filter((r) => r.userId !== id);
        }
        state.users[id] = { name: "退会した会員", deleted: true };
        state.me = null;
        save();
        go("#/login");
        toast("退会しました");
      },
    );
  },

  // ---- デモ ----
  "demo-reset": () => {
    confirmDialog(
      {
        title: "データを初期化しますか?",
        message: "プロトタイプで変更した内容がすべて最初の状態に戻ります。",
        ok: "初期化する",
      },
      () => {
        state = seed();
        save();
        go("#/trips");
        render();
        toast("データを初期化しました");
      },
    );
  },
  "demo-remote": () => {
    const trip = currentTrip();
    if (!trip || !membership(trip)) return toast("旅の画面を開いてから試してください");
    const other = trip.members.find((m) => m.userId !== me());
    if (!other) return toast("ほかのメンバーがいない旅です");
    const used = new Set(trip.items.map((i) => i.place?.name));
    const near = PLACES.filter(
      (p) => !used.has(p.name) && Math.abs(p.lat - (trip.items[0]?.place?.lat ?? p.lat)) < 1,
    );
    const p = near[0] ?? PLACES[0];
    const item = {
      id: newId("i"),
      day: ui.mapDay,
      time: "",
      title: p.name,
      place: { ...p },
      memo: "",
      version: 1,
      updatedBy: other.userId,
      updatedAt: nowIso(),
      comments: [],
    };
    trip.items.push(item);
    ui.flashItemId = item.id;
    commit();
    toast(`${userName(other.userId)}さんが ${item.day}日目に「${item.title}」を追加しました`);
  },
};

function applyDraft(trip, item, draft) {
  const dayChanged = draft.day !== item.day;
  Object.assign(item, {
    time: draft.time,
    title: draft.title,
    place: draft.place,
    memo: draft.memo,
  });
  if (dayChanged) {
    // 別の日へ移すときは、その日の最後に入れる
    trip.items.splice(trip.items.indexOf(item), 1);
    item.day = draft.day;
    trip.items.push(item);
  }
  touch(item);
}

// ------------------------------------------------------------------
// 操作(フォーム)
// ------------------------------------------------------------------
const forms = {
  login(form) {
    const fd = new FormData(form);
    const errors = [];
    if (!/^\S+@\S+\.\S+$/.test(String(fd.get("email"))))
      errors.push("メールアドレスを正しく入力してください");
    if (!fd.get("password")) errors.push("パスワードを入力してください");
    if (!showErrors(form, errors)) return;
    state.me = "u1";
    if (state.users.u1.deleted) state.users.u1 = { name: "たろう" };
    save();
    go(ui.returnTo ?? "#/trips");
    ui.returnTo = null;
    toast("ログインしました");
  },
  signup(form) {
    const fd = new FormData(form);
    const name = String(fd.get("name")).trim();
    const errors = [];
    if (!name) errors.push("表示名を入力してください");
    if (name.length > 20) errors.push("表示名は 20 文字までです");
    if (!/^\S+@\S+\.\S+$/.test(String(fd.get("email"))))
      errors.push("メールアドレスを正しく入力してください");
    if (String(fd.get("password")).length < 8) errors.push("パスワードは 8 文字以上にしてください");
    if (!showErrors(form, errors)) return;
    ui.signupDraft = { name, email: String(fd.get("email")) };
    go("#/signup/confirm");
  },
  "signup-confirm"(form) {
    const code = String(new FormData(form).get("code"));
    if (!showErrors(form, /^\d{6}$/.test(code) ? [] : ["6 けたの数字を入力してください"])) return;
    const id = newId("u");
    state.users[id] = { name: ui.signupDraft.name };
    state.me = id;
    ui.signupDraft = null;
    save();
    go(ui.returnTo ?? "#/trips");
    ui.returnTo = null;
    toast("登録しました。ようこそ!");
  },
  "password-reset"(form) {
    const fd = new FormData(form);
    const errors = [];
    if (!/^\S+@\S+\.\S+$/.test(String(fd.get("email"))))
      errors.push("メールアドレスを正しく入力してください");
    if (!/^\d{6}$/.test(String(fd.get("code"))))
      errors.push("確認コード(6 けたの数字)を入力してください");
    if (String(fd.get("password")).length < 8)
      errors.push("新しいパスワードは 8 文字以上にしてください");
    if (!showErrors(form, errors)) return;
    go("#/login");
    toast("パスワードを変更しました。新しいパスワードでログインしてください");
  },
  "new-trip"(form) {
    const { errors, value } = validateTrip(new FormData(form));
    if (!showErrors(form, errors)) return;
    const trip = {
      id: newId("t"),
      ...value,
      ownerId: me(),
      members: [{ userId: me(), role: "owner", joinedAt: nowIso() }],
      invite: { token: newToken(), expiresAt: daysFromNow(INVITE_DAYS) },
      publicToken: null,
      joinRequests: [],
      items: [],
      ideas: [],
      expenses: [],
    };
    state.trips.push(trip);
    save();
    go(`#/trips/${trip.id}`);
    toast("旅を作りました。メンバータブの招待リンクで友だちを誘えます");
  },
  "edit-trip"(form) {
    const trip = tripById(form.dataset.id);
    if (!requireOwner(trip)) return;
    const { errors, value } = validateTrip(new FormData(form));
    const lastDay = Math.max(0, ...trip.items.map((i) => i.day));
    if (!errors.length && tripDays(value) < lastDay)
      errors.push(
        `${lastDay}日目に予定があるため、${lastDay}日間より短くできません。先に予定を動かしてください`,
      );
    if (!showErrors(form, errors)) return;
    Object.assign(trip, value);
    commit();
    toast("旅の情報を保存しました");
  },
  item(form) {
    const fd = new FormData(form);
    const draft = {
      day: Number(fd.get("day")),
      time: String(fd.get("time") ?? ""),
      title: String(fd.get("title") ?? "").trim(),
      place: dialogState.place,
      memo: String(fd.get("memo") ?? ""),
    };
    const placeText = $("#it-place").value.trim();
    const errors = [];
    if (!draft.title) errors.push("タイトルを入力してください");
    if (draft.title.length > 100) errors.push("タイトルは 100 文字までです");
    if (draft.memo.length > 1000) errors.push("メモは 1000 文字までです");
    if (placeText && (!draft.place || draft.place.name !== placeText))
      errors.push(
        "場所は候補から選んでください(地図に出すため)。場所を付けないときは空にしてください",
      );
    if (!showErrors(form, errors, "item-errors")) return;

    const trip = tripById(dialogState.tripId);
    if (!dialogState.itemId) {
      if (trip.items.length >= 300)
        return showErrors(form, ["予定は 1 つの旅に 300 件までです"], "item-errors");
      const item = {
        id: newId("i"),
        ...draft,
        version: 1,
        updatedBy: me(),
        updatedAt: nowIso(),
        comments: [],
      };
      trip.items.push(item);
      ui.flashItemId = item.id;
      ui.mapDay = item.day;
      closeDialog();
      commit();
      toast(`「${item.title}」を追加しました`);
      return;
    }
    const item = trip.items.find((i) => i.id === dialogState.itemId);
    if (!item) {
      closeDialog();
      render();
      return toast("この予定はほかの人が削除しました");
    }
    // 楽観ロック: 編集を始めたときの版のままか(本番はサーバーが確かめて 409 を返す)
    if (item.version !== dialogState.baseVersion) {
      openConflictDialog(trip, item, draft);
      return;
    }
    applyDraft(trip, item, draft);
    ui.flashItemId = item.id;
    closeDialog();
    commit();
    toast(`「${item.title}」を保存しました`);
  },
  comment(form) {
    const body = String(new FormData(form).get("body") ?? "").trim();
    if (!body) return toast("コメントを入力してください");
    const trip = currentTrip();
    const item = trip.items.find((i) => i.id === form.dataset.id);
    item.comments.push({
      id: newId("c"),
      userId: me(),
      body: body.slice(0, 200),
      createdAt: nowIso(),
    });
    commit();
    const details = $(`#item-${item.id} details`);
    if (details) details.open = true;
    $(`#cm-${item.id}`)?.focus();
  },
  idea(form) {
    const fd = new FormData(form);
    const name = String(fd.get("name") ?? "").trim();
    const note = String(fd.get("note") ?? "").trim();
    const errors = [];
    if (!name) errors.push("場所を入力してください");
    if (name.length > 100) errors.push("場所は 100 文字までです");
    if (note.length > 100) errors.push("ひとことは 100 文字までです");
    if (!showErrors(form, errors, "idea-errors")) return;
    const trip = currentTrip();
    trip.ideas.push({
      id: newId("d"),
      name,
      place: place(name),
      note,
      createdBy: me(),
      votes: [me()],
      adoptedItemId: null,
    });
    commit();
    toast(`「${name}」を候補に出しました`);
  },
  adopt(form) {
    const trip = currentTrip();
    const idea = trip.ideas.find((i) => i.id === form.dataset.id);
    if (idea.adoptedItemId) return closeDialog();
    const day = Number(new FormData(form).get("day"));
    const item = {
      id: newId("i"),
      day,
      time: "",
      title: idea.name,
      place: idea.place,
      memo: idea.note,
      version: 1,
      updatedBy: me(),
      updatedAt: nowIso(),
      comments: [],
    };
    trip.items.push(item);
    idea.adoptedItemId = item.id;
    closeDialog();
    commit();
    toast(`「${idea.name}」を ${day}日目に入れました`);
  },
  expense(form) {
    const fd = new FormData(form);
    const title = String(fd.get("title") ?? "").trim();
    const amount = Number(fd.get("amount"));
    const splitWith = fd.getAll("splitWith").map(String);
    const errors = [];
    if (!title) errors.push("内容を入力してください");
    if (!Number.isInteger(amount) || amount < 1 || amount > 10_000_000)
      errors.push("金額は 1 円以上 1000 万円以下の整数にしてください");
    if (!splitWith.length) errors.push("分け合う人を 1 人以上選んでください");
    if (!showErrors(form, errors, "exp-errors")) return;
    const trip = currentTrip();
    trip.expenses.push({
      id: newId("e"),
      title,
      amount,
      paidBy: String(fd.get("paidBy")),
      splitWith,
      createdAt: nowIso(),
    });
    commit();
    toast(`「${title}」${yen(amount)}を記録しました`);
  },
  transfer(form) {
    const trip = currentTrip();
    if (!requireOwner(trip)) return;
    const to = String(new FormData(form).get("to"));
    confirmDialog(
      {
        title: "オーナーを引き継ぎますか?",
        message: `${userName(to)}さんがオーナーになり、あなたはメンバーになります。`,
        ok: "引き継ぐ",
        danger: false,
      },
      () => {
        membership(trip).role = "member";
        membership(trip, to).role = "owner";
        trip.ownerId = to;
        commit();
        toast(`${userName(to)}さんにオーナーを引き継ぎました`);
      },
    );
  },
  profile(form) {
    const name = String(new FormData(form).get("name") ?? "").trim();
    const errors = [];
    if (!name) errors.push("表示名を入力してください");
    if (name.length > 20) errors.push("表示名は 20 文字までです");
    if (!showErrors(form, errors)) return;
    state.users[me()].name = name;
    commit();
    toast("表示名を保存しました");
  },
};

// ------------------------------------------------------------------
// イベントのつなぎ込み(画面を描き直しても効くように、document でまとめて受ける)
// ------------------------------------------------------------------
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (fn) {
    e.preventDefault();
    fn(el, e);
  }
});
document.addEventListener("submit", (e) => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  forms[form.dataset.form]?.(form);
});
document.addEventListener("change", (e) => {
  const el = e.target.closest("[data-change]");
  if (!el) return;
  if (el.dataset.change === "switch-user") {
    state.me = el.value || null;
    save();
    // 見られない画面にいたら、「見つかりません」またはログイン画面になる(本番と同じ)
    render();
    toast(state.me ? `${userName(state.me)}さんとして表示しています` : "ログアウトした状態です");
  }
  if (el.dataset.change === "theme") {
    state.theme = el.value;
    commit();
  }
});
window.addEventListener("hashchange", render);

render();
