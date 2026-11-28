import {
  DeleteConnectionCommand,
  GoneException,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import type { ServerMessage } from "@tritri/shared";
import type { Sender } from "./types.js";

/** ApiGatewayManagementApiClient のうち、使う分だけ(テストで差し替えられるように) */
export interface ManagementClient {
  send(command: PostToConnectionCommand | DeleteConnectionCommand): Promise<unknown>;
}

const isGone = (error: unknown) =>
  error instanceof GoneException ||
  (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 410;

/**
 * 本番の接続へ送る部品(API Gateway WebSocket の管理 API)。
 * 相手がもういなければ(410)"gone"。$connect の最中の接続も 410 になるが、
 * そのときに消された接続は、次の ping で切れて、画面がつなぎ直す(service.ts の message)。
 */
export function createApiGatewaySender(client: ManagementClient): Sender {
  const encoder = new TextEncoder();
  return {
    async send(connectionId, message: ServerMessage) {
      try {
        await client.send(
          new PostToConnectionCommand({
            ConnectionId: connectionId,
            Data: encoder.encode(JSON.stringify(message)),
          }),
        );
        return "sent";
      } catch (error) {
        if (isGone(error)) return "gone";
        throw error;
      }
    },
    async close(connectionId) {
      try {
        await client.send(new DeleteConnectionCommand({ ConnectionId: connectionId }));
      } catch (error) {
        if (!isGone(error)) throw error;
      }
    },
  };
}
