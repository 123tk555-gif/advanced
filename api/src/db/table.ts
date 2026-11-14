import { CreateTableCommand } from "@aws-sdk/client-dynamodb";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

/** Main テーブルの GSI の名前(docs/データ設計.md) */
export const GSI1 = "GSI1";

/**
 * Main テーブルを作る(DynamoDB Local 用)。
 * AWS 上のテーブルは CDK で同じキー構成に作る。変えるときは両方を直すこと。
 */
export async function createTable(db: DynamoDBDocumentClient, tableName: string): Promise<void> {
  await db.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "PK", AttributeType: "S" },
        { AttributeName: "SK", AttributeType: "S" },
        { AttributeName: "GSI1PK", AttributeType: "S" },
        { AttributeName: "GSI1SK", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: GSI1,
          KeySchema: [
            { AttributeName: "GSI1PK", KeyType: "HASH" },
            { AttributeName: "GSI1SK", KeyType: "RANGE" },
          ],
          Projection: { ProjectionType: "ALL" },
        },
      ],
    }),
  );
}

/** キーの組み立て(文字列の形を 1 か所にまとめる) */
export const keys = {
  profile: (userId: string) => ({ PK: `USER#${userId}`, SK: "PROFILE" }),
  tripMeta: (tripId: string) => ({ PK: `TRIP#${tripId}`, SK: "META" }),
  member: (tripId: string, userId: string) => ({ PK: `TRIP#${tripId}`, SK: `MEMBER#${userId}` }),
  memberGsi: (userId: string, joinedAt: string, tripId: string) => ({
    GSI1PK: `USER#${userId}`,
    GSI1SK: `TRIP#${joinedAt}#${tripId}`,
  }),
  joinRequest: (tripId: string, userId: string) => ({
    PK: `TRIP#${tripId}`,
    SK: `JOINREQ#${userId}`,
  }),
  item: (tripId: string, itemId: string) => ({ PK: `TRIP#${tripId}`, SK: `ITEM#${itemId}` }),
  invite: (token: string) => ({ PK: `INVITE#${token}`, SK: "INVITE" }),
  tripPk: (tripId: string) => `TRIP#${tripId}`,
  userPk: (userId: string) => `USER#${userId}`,
};
