import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { type CommentCreate, MAX_COMMENTS_PER_ITEM } from "@tritri/shared";
import { ulid } from "ulid";
import type { Deps } from "../context.js";
import { deleteAll, queryKeys } from "../db/batch.js";
import { failedConditionIndex, retryOnConflict } from "../db/errors.js";
import { keys } from "../db/table.js";
import type { Member } from "./trips.js";

/** 抜けた人・外された人のコメントに出す名前 */
export const FORMER_MEMBER_NAME = "元メンバー";

export interface Comment {
  commentId: string;
  itemId: string;
  userId: string;
  /** 書いた人の今の表示名(メンバーでなくなっていれば「元メンバー」) */
  authorName: string;
  body: string;
  createdAt: string;
}

/** 旅のデータ(CMT#)から、予定ごとのコメントの一覧(古い順)を作る */
export function groupComments(
  records: Record<string, unknown>[],
  members: Member[],
): Map<string, Comment[]> {
  const names = new Map(members.map((m) => [m.userId, m.displayName]));
  const byItem = new Map<string, Comment[]>();
  for (const r of records) {
    const comment: Comment = {
      commentId: r.commentId as string,
      itemId: r.itemId as string,
      userId: r.userId as string,
      authorName: names.get(r.userId as string) ?? FORMER_MEMBER_NAME,
      body: r.body as string,
      createdAt: r.createdAt as string,
    };
    const list = byItem.get(comment.itemId) ?? [];
    list.push(comment);
    byItem.set(comment.itemId, list);
  }
  for (const list of byItem.values()) list.sort((a, b) => a.commentId.localeCompare(b.commentId));
  return byItem;
}

/**
 * コメントを書く。予定があること・予定ごとの件数の上限を、同じトランザクションで確かめる。
 * 件数は予定の commentCount で数える(予定の version は変えないので、同時編集の邪魔をしない)。
 */
export async function createComment(
  deps: Deps,
  tripId: string,
  itemId: string,
  me: Member,
  input: CommentCreate,
): Promise<{ comment: Comment } | { error: "not_found" | "too_many" }> {
  const comment: Comment = {
    commentId: ulid(),
    itemId,
    userId: me.userId,
    authorName: me.displayName,
    body: input.body,
    createdAt: deps.now().toISOString(),
  };
  const { authorName: _, ...stored } = comment; // 名前は表示のたびにメンバー情報から引く
  try {
    await retryOnConflict(() =>
      deps.db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: deps.tableName,
                Item: {
                  ...keys.comment(tripId, itemId, comment.commentId),
                  type: "comment",
                  ...stored,
                },
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            {
              Update: {
                TableName: deps.tableName,
                Key: keys.item(tripId, itemId),
                UpdateExpression: "SET commentCount = if_not_exists(commentCount, :zero) + :one",
                ConditionExpression:
                  "attribute_exists(PK) AND (attribute_not_exists(commentCount) OR commentCount < :max)",
                ExpressionAttributeValues: {
                  ":zero": 0,
                  ":one": 1,
                  ":max": MAX_COMMENTS_PER_ITEM,
                },
              },
            },
          ],
        }),
      ),
    );
    return { comment };
  } catch (error) {
    if (failedConditionIndex(error) !== 1) throw error;
    const item = await deps.db.send(
      new GetCommand({
        TableName: deps.tableName,
        Key: keys.item(tripId, itemId),
        ConsistentRead: true,
      }),
    );
    return item.Item ? { error: "too_many" } : { error: "not_found" };
  }
}

/** コメントを消す(書いた本人だけ) */
export async function deleteComment(
  deps: Deps,
  tripId: string,
  itemId: string,
  commentId: string,
  me: Member,
): Promise<"deleted" | "not_found" | "forbidden"> {
  const key = keys.comment(tripId, itemId, commentId);
  const res = await deps.db.send(
    new GetCommand({ TableName: deps.tableName, Key: key, ConsistentRead: true }),
  );
  if (!res.Item) return "not_found";
  if (res.Item.userId !== me.userId) return "forbidden";
  try {
    await retryOnConflict(() =>
      deps.db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Delete: {
                TableName: deps.tableName,
                Key: key,
                ConditionExpression: "attribute_exists(PK)",
              },
            },
            {
              Update: {
                TableName: deps.tableName,
                Key: keys.item(tripId, itemId),
                UpdateExpression: "SET commentCount = commentCount - :one",
                // 予定が消えていたら、件数は直さない(消えた予定を作り直さないように)
                ConditionExpression: "attribute_exists(PK)",
                ExpressionAttributeValues: { ":one": 1 },
              },
            },
          ],
        }),
      ),
    );
    return "deleted";
  } catch (error) {
    const index = failedConditionIndex(error);
    if (index === 0) return "not_found";
    if (index === 1) {
      // 予定はもう無い: コメントだけ消す
      await deleteAll(deps, [key]);
      return "deleted";
    }
    throw error;
  }
}

/** 予定を消した後の後片付け: その予定のコメントをすべて消す */
export async function deleteCommentsOfItem(deps: Deps, tripId: string, itemId: string) {
  await deleteAll(deps, await queryKeys(deps, keys.tripPk(tripId), `CMT#${itemId}#`));
}
