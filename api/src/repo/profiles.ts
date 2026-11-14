import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { Deps } from "../context.js";
import { keys } from "../db/table.js";

export interface Profile {
  userId: string;
  displayName: string;
}

export async function getProfile(deps: Deps, userId: string): Promise<Profile | undefined> {
  const res = await deps.db.send(
    new GetCommand({ TableName: deps.tableName, Key: keys.profile(userId) }),
  );
  if (!res.Item) return undefined;
  return { userId, displayName: res.Item.displayName as string };
}

export async function putProfile(deps: Deps, profile: Profile): Promise<void> {
  await deps.db.send(
    new PutCommand({
      TableName: deps.tableName,
      Item: { ...keys.profile(profile.userId), displayName: profile.displayName },
    }),
  );
}
