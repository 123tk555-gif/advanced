import {
  BatchWriteCommand,
  type BatchWriteCommandOutput,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Deps } from "../context.js";

/**
 * まとめて消す(25 件ずつ。処理されなかった分はやり直す)。
 * トランザクションではないので、後片付け(消し残しても画面に出ないもの)にだけ使う。
 */
export async function deleteAll(deps: Deps, keyList: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < keyList.length; i += 25) {
    let requests: NonNullable<BatchWriteCommandOutput["UnprocessedItems"]>[string] | undefined =
      keyList.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } }));
    for (let attempt = 0; requests && requests.length > 0; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 50 * attempt));
      const res: BatchWriteCommandOutput = await deps.db.send(
        new BatchWriteCommand({ RequestItems: { [deps.tableName]: requests } }),
      );
      requests = res.UnprocessedItems?.[deps.tableName];
    }
  }
}

/** PK が pk で、SK が prefix で始まる項目のキーをすべて取る(prefix が空ならすべて) */
export async function queryKeys(
  deps: Deps,
  pk: string,
  prefix: string,
): Promise<Record<string, unknown>[]> {
  const result: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await deps.db.send(
      new QueryCommand({
        TableName: deps.tableName,
        KeyConditionExpression: prefix ? "PK = :pk AND begins_with(SK, :prefix)" : "PK = :pk",
        ExpressionAttributeValues: prefix ? { ":pk": pk, ":prefix": prefix } : { ":pk": pk },
        ProjectionExpression: "PK, SK",
        ExclusiveStartKey: startKey,
        ConsistentRead: true,
      }),
    );
    result.push(...(res.Items ?? []));
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return result;
}
