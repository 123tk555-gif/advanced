import { DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";

/** テストの前に、DynamoDB Local が動いているかを確かめる */
export default async function globalSetup() {
  process.env.DYNAMODB_ENDPOINT ??= "http://localhost:8000";
  const client = new DynamoDBClient({
    endpoint: process.env.DYNAMODB_ENDPOINT,
    region: "local",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });
  try {
    await client.send(new ListTablesCommand({}));
  } catch {
    throw new Error(
      `DynamoDB Local に接続できません(${process.env.DYNAMODB_ENDPOINT})。` +
        "先に `docker compose up -d dynamodb` を実行してください。",
    );
  } finally {
    client.destroy();
  }
}
