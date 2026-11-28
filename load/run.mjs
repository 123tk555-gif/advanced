// 負荷試験の実行。
//   node load/run.mjs <ラベル> [L1 L2 ...] [--quick]
// 試験ごとに専用の DB と API を作り直し、終わったら片付ける。普段の環境(8000 / 8787)には触らない。
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { API, fillTypical, openDb, ScanCommand, seedTrip } from "./checks/common.mjs";
import { integrity } from "./checks/integrity.mjs";
import { maxData } from "./checks/max-data.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const loadDir = join(root, "load");
const compose = ["compose", "-f", join(loadDir, "compose.yaml")];
const K6_IMAGE = "grafana/k6:2.3.0";
const PORT = 8790;
const TABLE = "tritri-load";
const ORIGIN = "http://localhost:3000";

const args = process.argv.slice(2);
const quick = args.includes("--quick");
const [label, ...picked] = args.filter((a) => !a.startsWith("--"));
if (!label || !/^[\w-]+$/.test(label)) {
  console.error("使い方: node load/run.mjs <ラベル> [L1 L2 ...] [--quick]");
  process.exit(2);
}
const out = join(loadDir, "results", label);
const work = join(loadDir, ".work");
mkdirSync(out, { recursive: true });
mkdirSync(work, { recursive: true });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let api = null;

function stopApi() {
  if (api && api.exitCode === null) api.kill();
  api = null;
}

async function freshEnvironment(id) {
  stopApi();
  execFileSync("docker", [...compose, "down"], { stdio: "pipe" });
  execFileSync("docker", [...compose, "up", "-d"], { stdio: "pipe" });
  await wait(4000);
  const monitor = join(work, `${label}-${id}-monitor.jsonl`);
  rmSync(monitor, { force: true });
  let log = "";
  api = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--import",
      pathToFileURL(join(loadDir, "monitor.mjs")).href,
      "src/dev-server.ts",
    ],
    {
      cwd: join(root, "api"),
      env: {
        ...process.env,
        PORT: String(PORT),
        TABLE_NAME: TABLE,
        DYNAMODB_ENDPOINT: "http://127.0.0.1:8001",
        WEB_ORIGIN: ORIGIN,
        MONITOR_FILE: monitor,
        ...(process.env.LOAD_PROFILE
          ? { PROFILE_FILE: join(work, `${label}-${id}.cpuprofile`) }
          : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const child = api;
  const keep = (chunk) => {
    log = (log + chunk).slice(-200_000);
  };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`API が起動しない: ${log.slice(-1500)}`);
    try {
      if ((await fetch(`${API}/me`)).status === 401) {
        return { db: openDb(), table: TABLE, monitor, log: () => log, quick };
      }
    } catch {
      // まだ起動していない
    }
    await wait(500);
  }
  throw new Error("API が起動しない(60 秒)");
}

function k6(script, seed, env) {
  writeFileSync(join(work, "seed.json"), JSON.stringify(seed));
  const result = join(work, "summary.json");
  rmSync(result, { force: true });
  const all = {
    BASE_URL: `http://host.docker.internal:${PORT}`,
    WEB_ORIGIN: ORIGIN,
    SEED: "/work/seed.json",
    OUT: "/work/summary.json",
    K6_NO_USAGE_REPORT: "true",
    ...env,
  };
  const argv = [
    "run",
    "--rm",
    "--user",
    "0",
    "-v",
    `${join(loadDir, "k6")}:/scripts:ro`,
    "-v",
    `${work}:/work`,
    ...Object.entries(all).flatMap(([key, value]) => ["-e", `${key}=${value}`]),
    K6_IMAGE,
    "run",
    "--quiet",
    `/scripts/${script}`,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("docker", argv, { stdio: ["ignore", "pipe", "pipe"] });
    let errors = "";
    child.stdout.on("data", () => {});
    child.stderr.on("data", (chunk) => {
      errors = (errors + chunk).slice(-3000);
    });
    child.on("close", (code) => {
      try {
        const summary = JSON.parse(readFileSync(result, "utf8"));
        resolve({ code, metrics: pickMetrics(summary.metrics), notes: errors.slice(-800) });
      } catch {
        reject(new Error(`k6 が失敗 (${code}): ${errors}`));
      }
    });
  });
}

/** 記録に残す値だけにする */
function pickMetrics(metrics) {
  const kept = {};
  for (const [name, metric] of Object.entries(metrics)) {
    if (
      !/^(app_|ws_|delivery|writes_ok|receivers|recover|checks|http_reqs|data_received|dropped)/.test(
        name,
      )
    ) {
      continue;
    }
    kept[name] = { ...metric.values };
    if (metric.thresholds) {
      kept[name].thresholds = Object.fromEntries(
        Object.entries(metric.thresholds).map(([rule, r]) => [rule, r.ok]),
      );
    }
  }
  return kept;
}

/** perTrip 人ずつの旅を作り、利用者ごとに担当の予定・候補を割り当てる */
async function seedPeople(people, perTrip) {
  const users = [];
  for (let left = people; left > 0; left -= perTrip) {
    const trip = await seedTrip(Math.min(left, perTrip));
    const { items, ideas } = await fillTypical(trip);
    trip.ids.forEach((userId, i) => {
      const item = items[i % items.length];
      const idea = ideas[i % ideas.length];
      users.push({
        userId,
        tripId: trip.tripId,
        itemId: item.itemId,
        version: 1,
        ideaId: idea.ideaId,
      });
    });
  }
  return { users };
}

async function seedHot(members) {
  const trip = await seedTrip(members);
  const { items } = await fillTypical(trip);
  return {
    tripId: trip.tripId,
    users: trip.ids.map((userId) => ({ userId })),
    itemId: items[0].itemId,
    version: 1,
  };
}

async function connectionsLeft({ db, table }) {
  await wait(5000);
  let count = 0;
  let start;
  do {
    const res = await db.send(
      new ScanCommand({
        TableName: `${table}-connections`,
        FilterExpression: "begins_with(SK, :conn)",
        ExpressionAttributeValues: { ":conn": "CONN" },
        ExclusiveStartKey: start,
        ConsistentRead: true,
      }),
    );
    count += res.Count;
    start = res.LastEvaluatedKey;
  } while (start);
  return count;
}

const q = (full, short) => String(quick ? short : full);

const tests = {
  L1: async () => k6("baseline.js", {}, { DURATION: `${q(60, 10)}s` }),
  L2: async () => {
    const n = Number(q(100, 10));
    return k6("normal.js", await seedPeople(n, 5), { VUS: n, SECONDS: q(600, 15) });
  },
  L3: async (env) => {
    const n = Number(q(50, 5));
    const result = await k6("hot.js", await seedHot(n), { VUS: n, SECONDS: q(300, 10) });
    const count = (name) => result.metrics[name]?.count ?? 0;
    const expected = count("writes_ok") * n;
    return {
      ...result,
      expectedSignals: expected,
      missingSignals: expected - count("ws_signals"),
      notCaughtUp: n - count("receivers_caught_up"),
      connectionsLeft: await connectionsLeft(env),
    };
  },
  L4: async () => {
    const steps = [];
    for (const n of quick ? [5, 10] : [50, 100, 200, 400, 800]) {
      const env = await freshEnvironment(`L4-${n}`);
      const result = await k6("normal.js", await seedPeople(n, 5), { VUS: n, SECONDS: q(120, 10) });
      steps.push({ people: n, ...result, server: serverStats(env) });
      const p95 = result.metrics.app_read_ms?.["p(95)"];
      console.log(`  L4 ${n} 人: read p95=${Math.round(p95)}ms exit=${result.code}`);
    }
    return { steps };
  },
  // 調査用(既定の一覧には入れない): 100 人で 2 分。LOAD_PROFILE=1 と一緒に使う
  P2: async () => k6("normal.js", await seedPeople(100, 5), { VUS: 100, SECONDS: "120" }),
  L5: maxData,
  L6: integrity,
  L7: async (env) => {
    const n = Number(q(50, 5));
    const seed = await seedPeople(n, 5);
    const result = await k6("normal.js", seed, { VUS: n, SECONDS: q(1800, 15), WITH_WS: "1" });
    return { ...result, connectionsLeft: await connectionsLeft(env) };
  },
  L8: async (env) => {
    const n = Number(q(50, 5));
    const result = await k6("reconnect.js", await seedHot(n), { VUS: n });
    return { ...result, connectionsLeft: await connectionsLeft(env) };
  },
};

function serverStats(env) {
  let rows = [];
  try {
    rows = readFileSync(env.monitor, "utf8").trim().split("\n").map(JSON.parse);
  } catch {
    return null;
  }
  const max = (key) => Math.max(...rows.map((r) => r[key]));
  const avg = (key, list) =>
    list.length ? Math.round(list.reduce((sum, r) => sum + r[key], 0) / list.length) : null;
  // 増え続けていないかを、区間を 6 つに分けて見る
  const size = Math.ceil(rows.length / 6);
  const trend = Array.from({ length: 6 }, (_, i) => rows.slice(i * size, (i + 1) * size))
    .filter((list) => list.length)
    .map((list) => ({ rssMb: avg("rssMb", list), heapMb: avg("heapMb", list) }));
  const log = env.log();
  return {
    samples: rows.length,
    maxRssMb: max("rssMb"),
    maxCpuPct: max("cpuPct"),
    maxLoopP99Ms: max("loopP99Ms"),
    trend,
    errorLines: log
      .split("\n")
      .filter((line) => /^\S*(Error|Exception)\b|に失敗しました/.test(line))
      .slice(0, 10),
  };
}

function cleanUp() {
  stopApi();
  try {
    execFileSync("docker", [...compose, "down"], { stdio: "pipe" });
  } catch (error) {
    console.error("片付けに失敗しました", error.message);
  }
}
process.on("SIGINT", () => {
  cleanUp();
  process.exit(130);
});

try {
  for (const id of picked.length ? picked : Object.keys(tests).filter((k) => k !== "P2")) {
    const began = new Date();
    console.log(`${id} 開始 ${began.toLocaleTimeString("ja-JP")}`);
    let record;
    try {
      const env = await freshEnvironment(id);
      const result = await tests[id](env);
      record = { result, server: id === "L4" ? null : serverStats(env) };
      if (id !== "L4") copyMonitor(env, id);
    } catch (error) {
      record = { failed: String(error.stack ?? error).slice(0, 3000) };
    }
    const ended = new Date();
    const file = join(out, `${id}.json`);
    const meta = { id, quick, began: began.toISOString(), ended: ended.toISOString() };
    writeFileSync(file, `${JSON.stringify({ ...meta, ...record }, null, 2)}\n`);
    const took = Math.round((ended - began) / 1000);
    console.log(`${id} 終了 ${took} 秒${record.failed ? `\n${record.failed}` : ""}`);
  }
} finally {
  cleanUp();
}

function copyMonitor(env, id) {
  try {
    copyFileSync(env.monitor, join(out, `${id}-server.jsonl`));
  } catch {
    // 短すぎて記録が無い
  }
}
