// 画面を本番用に作り、S3 に上げて、CloudFront の古い控えを消す。
//   node infra/deploy-web.mjs --profile taskboard [--dry-run]
// 先に `cdk deploy` でスタック TriTri を作っておく(出力の値を使う)。
// Google マップのキーと Map ID は web/.env から読む(git には入れない)。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const profileAt = args.indexOf("--profile");
const profile = profileAt >= 0 ? args[profileAt + 1] : undefined;
if (!profile) {
  console.error("--profile <AWS のプロファイル名> を付けてください(例: --profile taskboard)");
  process.exit(1);
}
const region = "ap-northeast-1";
const windows = process.platform === "win32";

function run(cmd, cmdArgs, options = {}) {
  console.log(`$ ${cmd} ${cmdArgs.join(" ")}`);
  return execFileSync(cmd, cmdArgs, {
    cwd: root,
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
    shell: windows && cmd === "corepack",
    env: { ...process.env, ...options.env },
  });
}

/** 書き込む操作。--dry-run なら表示だけ */
function write(cmd, cmdArgs) {
  if (dryRun) console.log(`(試しなので実行しない) $ ${cmd} ${cmdArgs.join(" ")}`);
  else run(cmd, cmdArgs);
}

const aws = (cmdArgs) => ["--profile", profile, "--region", region, ...cmdArgs];

// 1. スタックの出力を読む
const stacks = JSON.parse(
  run("aws", aws(["cloudformation", "describe-stacks", "--stack-name", "TriTri"]), {
    capture: true,
  }),
);
const outputs = Object.fromEntries(
  (stacks.Stacks?.[0]?.Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue]),
);
for (const name of [
  "ApiUrl",
  "WsUrl",
  "UserPoolId",
  "UserPoolClientId",
  "SiteBucket",
  "DistributionId",
  "SiteUrl",
]) {
  if (!outputs[name]) {
    console.error(`スタックの出力 ${name} がありません。先に cdk deploy を実行してください`);
    process.exit(1);
  }
}

// 2. Google マップのキーがあるか(無いと本番でも仮の地図になる)
const envFile = join(root, "web", ".env");
const env = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
if (!/^NUXT_PUBLIC_GOOGLE_MAPS_API_KEY=\S+/m.test(env)) {
  console.warn("注意: web/.env に Google マップのキーがありません。地図は仮の簡略図になります");
}
if (!/^NUXT_PUBLIC_GOOGLE_MAPS_MAP_ID=\S+/m.test(env)) {
  console.warn("注意: web/.env に Map ID がありません。Google の試用の ID を使います");
}

// 3. 画面を作る(API・WebSocket・Cognito の場所を埋め込む。どれも公開されて構わない値)
run("corepack", ["pnpm", "--filter", "@tritri/web", "build"], {
  env: {
    NUXT_PUBLIC_API_BASE: outputs.ApiUrl,
    NUXT_PUBLIC_WS_URL: outputs.WsUrl,
    NUXT_PUBLIC_COGNITO_USER_POOL_ID: outputs.UserPoolId,
    NUXT_PUBLIC_COGNITO_CLIENT_ID: outputs.UserPoolClientId,
    NUXT_PUBLIC_AUTH_MODE: "",
  },
});
const dist = join(root, "web", ".output", "public");
if (!existsSync(join(dist, "index.html"))) {
  console.error(`画面のファイルが見つかりません: ${dist}`);
  process.exit(1);
}

// 4. 上げる。名前に版の入ったファイル(_nuxt)は長く控え、HTML は毎回確かめさせる
const bucket = `s3://${outputs.SiteBucket}`;
write(
  "aws",
  aws([
    "s3",
    "sync",
    join(dist, "_nuxt"),
    `${bucket}/_nuxt`,
    "--cache-control",
    "public,max-age=31536000,immutable",
  ]),
);
write(
  "aws",
  aws([
    "s3",
    "sync",
    dist,
    bucket,
    "--delete",
    "--exclude",
    "_nuxt/*",
    "--cache-control",
    "no-cache",
  ]),
);
write(
  "aws",
  aws([
    "cloudfront",
    "create-invalidation",
    "--distribution-id",
    outputs.DistributionId,
    "--paths",
    "/*",
  ]),
);

console.log(`\n${dryRun ? "(試し)" : "公開しました"}: ${outputs.SiteUrl}`);
