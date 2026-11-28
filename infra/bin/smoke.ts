/**
 * 公開の後の確かめ(読むだけ)。
 *   corepack pnpm --filter @tritri/infra smoke --profile <プロファイル>
 * 1 つでも不合格なら、終了コード 1 で終わる。
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { request } from "node:https";
import { type Probe, runSmoke, type SmokeOutputs } from "../lib/smoke.js";

const args = process.argv.slice(2);
const profile = args[args.indexOf("--profile") + 1];
if (!args.includes("--profile") || !profile) {
  console.error("--profile <AWS のプロファイル名> を付けてください(例: --profile taskboard)");
  process.exit(1);
}

const stacks = JSON.parse(
  execFileSync(
    "aws",
    [
      "--profile",
      profile,
      "--region",
      "ap-northeast-1",
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      "TriTri",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  ),
) as { Stacks?: { Outputs?: { OutputKey: string; OutputValue: string }[] }[] };
const outputs = Object.fromEntries(
  (stacks.Stacks?.[0]?.Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue]),
) as unknown as SmokeOutputs;

const TIMEOUT_MS = 15_000;

const probe: Probe = {
  async http(req) {
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers ?? {},
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((value, name) => {
      headers[name.toLowerCase()] = value;
    });
    return { status: res.status, headers, body: await res.text() };
  },
  wsHandshake(url, origin) {
    // WebSocket の最初の HTTP のやり取りだけを行い、返ってきた状態番号を見る(つながっても、すぐ切る)
    return new Promise((resolve, reject) => {
      const req = request(url.replace(/^wss:/, "https:"), {
        method: "GET",
        timeout: TIMEOUT_MS,
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
          Origin: origin,
        },
      });
      req.on("upgrade", (_res, socket) => {
        socket.destroy();
        resolve(101);
      });
      req.on("response", (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("timeout", () => req.destroy(new Error("時間切れ")));
      req.on("error", reject);
      req.end();
    });
  },
};

const results = await runSmoke(outputs, probe);
for (const r of results)
  console.log(`${r.ok ? "OK  " : "NG  "} ${r.name}${r.ok ? "" : ` — ${r.detail}`}`);
const failed = results.filter((r) => !r.ok).length;
console.log(
  failed ? `\n${failed} 件が不合格です` : `\nすべて合格(${results.length} 件): ${outputs.SiteUrl}`,
);
process.exit(failed ? 1 : 0);
