import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/**
 * DynamoDB のクライアントを作る。
 * endpoint を渡すと DynamoDB Local(手元・テスト)、省略すると AWS の DynamoDB を使う。
 */
export function createDocClient(options: { endpoint?: string } = {}): DynamoDBDocumentClient {
  const client = options.endpoint
    ? new DynamoDBClient({
        endpoint: options.endpoint,
        region: "local",
        credentials: { accessKeyId: "local", secretAccessKey: "local" },
      })
    : new DynamoDBClient({});
  // ログを出さないのに、応答のたびにログ用の整形をする部品を外す(負荷試験で CPU の約 6%)
  client.middlewareStack.remove("loggerMiddleware");
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
}
