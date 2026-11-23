import { GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { type IdeaAdopt, type IdeaCreate, MAX_IDEAS_PER_TRIP, type Place } from "@tritri/shared";
import { ulid } from "ulid";
import type { Deps } from "../context.js";
import { deleteAll } from "../db/batch.js";
import { failedConditionIndex, retryOnConflict } from "../db/errors.js";
import { keys } from "../db/table.js";
import { checkDay, type Item, itemCreateWrites, metaFailure, newItem } from "./items.js";
import type { Member } from "./trips.js";

/** 保存している候補 */
interface IdeaRecord {
  ideaId: string;
  name: string;
  place: Place | null;
  note: string;
  createdBy: string;
  createdAt: string;
  adoptedItemId: string | null;
}

/** 画面に返す候補(投票の情報つき) */
export interface Idea extends IdeaRecord {
  voteCount: number;
  voters: string[];
  myVote: boolean;
}

function toIdeaRecord(r: Record<string, unknown>): IdeaRecord {
  return {
    ideaId: r.ideaId as string,
    name: r.name as string,
    place: (r.place as Place | undefined) ?? null,
    note: (r.note as string | undefined) ?? "",
    createdBy: r.createdBy as string,
    createdAt: r.createdAt as string,
    adoptedItemId: (r.adoptedItemId as string | undefined) ?? null,
  };
}

/**
 * 旅のデータ(IDEA# と VOTE#)から、画面に返す候補の一覧を作る。票の多い順、同じなら古い順。
 * 票数は VOTE の数から数える(消えた候補の投票が残っていても数えない)。
 */
export function buildIdeas(
  ideaRecords: Record<string, unknown>[],
  voteRecords: Record<string, unknown>[],
  me: string,
): Idea[] {
  const voters = new Map<string, string[]>();
  for (const v of voteRecords) {
    const list = voters.get(v.ideaId as string) ?? [];
    list.push(v.userId as string);
    voters.set(v.ideaId as string, list);
  }
  return ideaRecords
    .map(toIdeaRecord)
    .map((idea) => {
      const list = voters.get(idea.ideaId) ?? [];
      return { ...idea, voteCount: list.length, voters: list, myVote: list.includes(me) };
    })
    .sort((a, b) => b.voteCount - a.voteCount || a.createdAt.localeCompare(b.createdAt));
}

function withoutAdopted({ adoptedItemId: _, ...rest }: IdeaRecord) {
  return rest;
}

async function getIdea(deps: Deps, tripId: string, ideaId: string) {
  const res = await deps.db.send(
    new GetCommand({
      TableName: deps.tableName,
      Key: keys.idea(tripId, ideaId),
      ConsistentRead: true,
    }),
  );
  return res.Item ? toIdeaRecord(res.Item) : undefined;
}

/** 候補を出す。旅の候補の件数(ideaCount)を同じトランザクションで数え、上限を守る */
export async function createIdea(
  deps: Deps,
  tripId: string,
  userId: string,
  input: IdeaCreate,
): Promise<{ idea: Idea } | { error: "too_many" }> {
  const record: IdeaRecord = {
    ideaId: ulid(),
    ...input,
    createdBy: userId,
    createdAt: deps.now().toISOString(),
    adoptedItemId: null,
  };
  try {
    await retryOnConflict(() =>
      deps.db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: deps.tableName,
                // adoptedItemId は採用するまで項目ごと持たない(null を入れると「ある」扱いになり、
                // 採用時の条件 attribute_not_exists(adoptedItemId) が成り立たなくなるため)
                Item: {
                  ...keys.idea(tripId, record.ideaId),
                  type: "idea",
                  ...withoutAdopted(record),
                },
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            {
              Update: {
                TableName: deps.tableName,
                Key: keys.tripMeta(tripId),
                UpdateExpression: "SET ideaCount = if_not_exists(ideaCount, :zero) + :one",
                ConditionExpression:
                  "attribute_exists(PK) AND (attribute_not_exists(ideaCount) OR ideaCount < :max)",
                ExpressionAttributeValues: { ":zero": 0, ":one": 1, ":max": MAX_IDEAS_PER_TRIP },
              },
            },
          ],
        }),
      ),
    );
    return { idea: { ...record, voteCount: 0, voters: [], myVote: false } };
  } catch (error) {
    if (failedConditionIndex(error) === 1) return { error: "too_many" };
    throw error;
  }
}

/** 候補を消す。出した本人かオーナーだけ。その候補の投票も一緒に消す */
export async function deleteIdea(
  deps: Deps,
  tripId: string,
  ideaId: string,
  me: Member,
): Promise<"deleted" | "not_found" | "forbidden"> {
  const idea = await getIdea(deps, tripId, ideaId);
  if (!idea) return "not_found";
  if (idea.createdBy !== me.userId && me.role !== "owner") return "forbidden";

  try {
    await retryOnConflict(() =>
      deps.db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Delete: {
                TableName: deps.tableName,
                Key: keys.idea(tripId, ideaId),
                ConditionExpression: "attribute_exists(PK)",
              },
            },
            {
              Update: {
                TableName: deps.tableName,
                Key: keys.tripMeta(tripId),
                UpdateExpression: "SET ideaCount = ideaCount - :one",
                // 旅が消えていたら書かない(消えた旅の META を作り直さないように)
                ConditionExpression: "attribute_exists(PK)",
                ExpressionAttributeValues: { ":one": 1 },
              },
            },
          ],
        }),
      ),
    );
  } catch (error) {
    if (failedConditionIndex(error) === 0) return "not_found";
    throw error;
  }
  // 投票は後から消す。抜けた人の票も残るので 100 件を超えることがあり、1 つのトランザクションには収まらない。
  // 消し残しても、候補が無いので数えられない(buildIdeas)
  const votes = await deps.db.send(
    new QueryCommand({
      TableName: deps.tableName,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
      ExpressionAttributeValues: { ":pk": keys.tripPk(tripId), ":prefix": `VOTE#${ideaId}#` },
      ProjectionExpression: "PK, SK",
      ConsistentRead: true,
    }),
  );
  await deleteAll(deps, votes.Items ?? []);
  return "deleted";
}

/** 投票(2 回押しても 1 票)。無い候補なら not_found */
export async function vote(
  deps: Deps,
  tripId: string,
  ideaId: string,
  userId: string,
): Promise<"ok" | "not_found"> {
  try {
    await retryOnConflict(() =>
      deps.db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: deps.tableName,
                Item: {
                  ...keys.vote(tripId, ideaId, userId),
                  type: "vote",
                  ideaId,
                  userId,
                  votedAt: deps.now().toISOString(),
                },
                ConditionExpression: "attribute_not_exists(PK)",
              },
            },
            {
              ConditionCheck: {
                TableName: deps.tableName,
                Key: keys.idea(tripId, ideaId),
                ConditionExpression: "attribute_exists(PK)",
              },
            },
          ],
        }),
      ),
    );
    return "ok";
  } catch (error) {
    const index = failedConditionIndex(error);
    if (index === 0) return "ok"; // もう投票している
    if (index === 1) return "not_found";
    throw error;
  }
}

/** 投票の取り消し(投票していなくても、何も起きずに成功) */
export async function unvote(
  deps: Deps,
  tripId: string,
  ideaId: string,
  userId: string,
): Promise<"ok"> {
  await deps.db.send(
    new TransactWriteCommand({
      TransactItems: [
        { Delete: { TableName: deps.tableName, Key: keys.vote(tripId, ideaId, userId) } },
      ],
    }),
  );
  return "ok";
}

/**
 * A11: 候補を旅程に入れる。予定を作ることと、候補を「採用済み」にすることを 1 つのトランザクションで行う。
 * 2 人が同時に採用しても、予定は 1 件だけできる。
 */
export async function adoptIdea(
  deps: Deps,
  tripId: string,
  ideaId: string,
  userId: string,
  input: IdeaAdopt,
): Promise<
  { item: Item } | { error: "not_found" | "day_out_of_range" | "too_many" | "already_adopted" }
> {
  const idea = await getIdea(deps, tripId, ideaId);
  if (!idea) return { error: "not_found" };
  if (idea.adoptedItemId) return { error: "already_adopted" };
  const failure = await checkDay(deps, tripId, input.day);
  if (failure) return failure;

  const item = newItem(deps, userId, {
    day: input.day,
    order: input.order,
    time: "",
    title: idea.name,
    place: idea.place,
    memo: idea.note,
  });
  try {
    await retryOnConflict(() =>
      deps.db.send(
        new TransactWriteCommand({
          TransactItems: [
            ...itemCreateWrites(deps, tripId, item),
            {
              Update: {
                TableName: deps.tableName,
                Key: keys.idea(tripId, ideaId),
                UpdateExpression: "SET adoptedItemId = :itemId",
                ConditionExpression: "attribute_exists(PK) AND attribute_not_exists(adoptedItemId)",
                ExpressionAttributeValues: { ":itemId": item.itemId },
              },
            },
          ],
        }),
      ),
    );
    return { item };
  } catch (error) {
    const index = failedConditionIndex(error);
    if (index === 1) return { error: await metaFailure(deps, tripId, input.day) };
    if (index === 2) {
      return (await getIdea(deps, tripId, ideaId))
        ? { error: "already_adopted" }
        : { error: "not_found" };
    }
    throw error;
  }
}
