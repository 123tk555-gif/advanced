import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";

/**
 * 本番で、ログイン中の利用者の ID を取り出す。
 * API Gateway の JWT オーソライザーが署名・期限を確かめたトークンの `sub` だけを信じる。
 * ヘッダーなど、利用者が自由に書き換えられる場所は見ない。
 */
export function userIdFromLambdaEvent(
  event: APIGatewayProxyEventV2WithJWTAuthorizer | undefined,
): string | undefined {
  const sub = event?.requestContext?.authorizer?.jwt?.claims?.sub;
  return typeof sub === "string" && sub !== "" ? sub : undefined;
}
