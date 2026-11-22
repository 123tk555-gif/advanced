import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import {
  type Editor,
  parseClientMessage,
  type ServerMessage,
  STALE_CONNECTION_MS,
  type Viewer,
} from "@tritri/shared";
import { keys } from "../db/table.js";
import { toMember } from "../repo/trips.js";
import {
  addConnection,
  type Connection,
  findConnection,
  listConnections,
  nextSeq,
  removeConnection,
  touchConnection,
} from "./connections.js";
import { issueTicket, useTicket } from "./tickets.js";
import type { Notifier, RealtimeDeps } from "./types.js";

/** 通信の入口(手元の ws・API Gateway の $connect など)から呼ぶ分も含めた、リアルタイム更新の全体 */
export interface Realtime extends Notifier {
  /** つないでよければ登録して true */
  connect(connectionId: string, ticket: string): Promise<boolean>;
  message(connectionId: string, raw: string): Promise<void>;
  disconnect(connectionId: string): Promise<void>;
}

export function createRealtime(deps: RealtimeDeps): Realtime {
  /** 今のメンバー(userId → 表示名)。旅が無ければ空 */
  async function currentMembers(tripId: string): Promise<Map<string, string>> {
    const [meta, members] = await Promise.all([
      deps.db.send(
        new GetCommand({
          TableName: deps.tableName,
          Key: keys.tripMeta(tripId),
          ConsistentRead: true,
        }),
      ),
      deps.db.send(
        new QueryCommand({
          TableName: deps.tableName,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
          ExpressionAttributeValues: { ":pk": keys.tripPk(tripId), ":prefix": "MEMBER#" },
          ConsistentRead: true,
        }),
      ),
    ]);
    if (!meta.Item) return new Map();
    return new Map((members.Items ?? []).map(toMember).map((m) => [m.userId, m.displayName]));
  }

  async function drop(connection: Connection, reason: "revoked" | "stale") {
    await removeConnection(deps, connection);
    try {
      if (reason === "revoked")
        await deps.sender.send(connection.connectionId, { type: "revoked" });
    } finally {
      await deps.sender.close(connection.connectionId);
    }
  }

  /** 送る。もういない接続は消して、その数を返す */
  async function sendAll(connections: Connection[], message: ServerMessage): Promise<number> {
    const results = await Promise.allSettled(
      connections.map(async (connection) => {
        if ((await deps.sender.send(connection.connectionId, message)) !== "gone") return false;
        await removeConnection(deps, connection);
        return true;
      }),
    );
    let gone = 0;
    for (const r of results) {
      // 1 人に送れなくても、ほかの人には届ける。届かなかった人は定期的な読み直しで追いつく
      if (r.status === "rejected") console.error("WebSocket の送信に失敗しました", r.reason);
      else if (r.value) gone += 1;
    }
    return gone;
  }

  /**
   * 旅の全員に配る。送る直前に今のメンバーと照合し、メンバーでない接続には何も送らずに切る。
   * signal が true なら「変わった」の合図も送る。
   */
  async function broadcast(tripId: string, signal: boolean): Promise<void> {
    const all = await listConnections(deps, tripId);
    if (!all.length) return;

    const seq = await nextSeq(deps, tripId);
    // 番号を取った後に読み直す(connections.ts の nextSeq)
    const [connections, members] = await Promise.all([
      listConnections(deps, tripId),
      currentMembers(tripId),
    ]);
    const oldest = deps.now().getTime() - STALE_CONNECTION_MS;
    const live: Connection[] = [];
    const dropping: Promise<void>[] = [];
    for (const c of connections) {
      if (!members.has(c.userId)) dropping.push(drop(c, "revoked"));
      else if (c.lastSeen < oldest) dropping.push(drop(c, "stale"));
      else live.push(c);
    }
    await Promise.allSettled(dropping);

    if (signal) await sendAll(live, { type: "changed" });

    const people = new Map<string, Viewer>();
    const editing = new Map<string, Editor>();
    for (const { userId, editingItemId: itemId } of live) {
      const displayName = members.get(userId) as string;
      people.set(userId, { userId, displayName });
      if (itemId) editing.set(`${itemId}#${userId}`, { itemId, userId, displayName });
    }
    const gone = await sendAll(live, {
      type: "presence",
      seq,
      people: [...people.values()].sort((a, b) => a.userId.localeCompare(b.userId)),
      editing: [...editing.values()],
    });
    // いなくなった人を除いて、もう一度配る(消えるたびに人数が減るので、必ず終わる)
    if (gone) await broadcast(tripId, false);
  }

  return {
    issueTicket: (tripId, userId) => issueTicket(deps, tripId, userId),

    changed: (tripId) => broadcast(tripId, true),

    async withdrawn(tripId, userId) {
      // 退会してもメンバー情報は残るので、照合では切れない
      const connections = await listConnections(deps, tripId);
      await Promise.allSettled(
        connections.filter((c) => c.userId === userId).map((c) => drop(c, "revoked")),
      );
      await broadcast(tripId, true);
    },

    async connect(connectionId, ticket) {
      const granted = await useTicket(deps, ticket);
      if (!granted) return false;
      const { tripId, userId } = granted;
      if (!(await currentMembers(tripId)).has(userId)) return false;
      await addConnection(deps, connectionId, tripId, userId);
      return true;
    },

    async message(connectionId, raw) {
      const message = parseClientMessage(raw);
      if (!message) return;
      const connection = await findConnection(deps, connectionId);
      const editing = message.type === "editing" ? message.itemId : undefined;
      if (!connection || !(await touchConnection(deps, connection, editing))) {
        // 掃除された接続など。切れば画面がチケットを取り直してつなぎ直す
        await deps.sender.close(connectionId);
        return;
      }
      if (message.type !== "ping") {
        await broadcast(connection.tripId, false);
        return;
      }
      await deps.sender.send(connectionId, { type: "pong" });
      const oldest = deps.now().getTime() - STALE_CONNECTION_MS;
      const others = await listConnections(deps, connection.tripId);
      if (others.some((c) => c.lastSeen < oldest)) await broadcast(connection.tripId, false);
    },

    async disconnect(connectionId) {
      const connection = await findConnection(deps, connectionId);
      if (!connection) return;
      await removeConnection(deps, connection);
      await broadcast(connection.tripId, false);
    },
  };
}
