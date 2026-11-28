import { App, Tags } from "aws-cdk-lib";
import { TriTriStack } from "../lib/stack.js";

/**
 * Tri-Tri の本番(東京リージョン)。
 *   corepack pnpm --filter @tritri/infra exec cdk diff --profile taskboard
 * 予算の通知を作るときは -c budgetEmail=<通知先> を付ける。
 */
const app = new App();
const budgetEmail = app.node.tryGetContext("budgetEmail") as string | undefined;
new TriTriStack(app, "TriTri", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: "ap-northeast-1" },
  ...(budgetEmail ? { budgetEmail } : {}),
  description: "Tri-Tri(みんなで作る旅のしおり)",
});
// 同じアカウントの別の資源(taskboard)と見分けられるように
Tags.of(app).add("app", "tritri");
