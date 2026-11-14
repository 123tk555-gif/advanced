import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { describe, expect, it } from "vitest";
import { userIdFromLambdaEvent } from "../src/auth.js";
import { TEST_USER_HEADER } from "./helpers.js";

/** API Gateway から届くイベントのうち、認証に関わる部分だけを作る */
function event(options: {
  sub?: unknown;
  headers?: Record<string, string>;
  noAuthorizer?: boolean;
}): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    headers: options.headers ?? {},
    requestContext: options.noAuthorizer
      ? {}
      : { authorizer: { jwt: { claims: { sub: options.sub }, scopes: [] } } },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

describe("本番の利用者の取り出し(userIdFromLambdaEvent)", () => {
  it("API Gateway が確かめた JWT の sub を使う", () => {
    expect(userIdFromLambdaEvent(event({ sub: "cognito-sub-1" }))).toBe("cognito-sub-1");
  });

  it("テスト用のヘッダーで名乗っても無視する", () => {
    expect(
      userIdFromLambdaEvent(
        event({ noAuthorizer: true, headers: { [TEST_USER_HEADER]: "u-evil" } }),
      ),
    ).toBeUndefined();
    expect(
      userIdFromLambdaEvent(event({ sub: "real", headers: { [TEST_USER_HEADER]: "u-evil" } })),
    ).toBe("real");
  });

  it.each([
    ["オーソライザーが無い(公開ルート)", event({ noAuthorizer: true })],
    ["sub が無い", event({})],
    ["sub が空文字", event({ sub: "" })],
    ["sub が文字列でない", event({ sub: 123 })],
    ["イベントが無い", undefined],
  ])("%s ときは、ログインしていない扱い", (_label, e) => {
    expect(userIdFromLambdaEvent(e)).toBeUndefined();
  });
});
