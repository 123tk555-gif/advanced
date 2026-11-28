import {
  DeleteConnectionCommand,
  GoneException,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { describe, expect, it, vi } from "vitest";
import { createApiGatewaySender } from "../src/realtime/apigw.js";

const gone = () => new GoneException({ message: "gone", $metadata: { httpStatusCode: 410 } });

function client(handler: (command: unknown) => Promise<unknown>) {
  return { send: vi.fn(handler) };
}

describe("API Gateway WebSocket へ送る部品", () => {
  it("接続の ID へ、JSON にして送る", async () => {
    const c = client(async () => ({}));
    const sender = createApiGatewaySender(c);
    expect(await sender.send("conn-1", { type: "changed" })).toBe("sent");
    const command = c.send.mock.calls[0]?.[0] as PostToConnectionCommand;
    expect(command).toBeInstanceOf(PostToConnectionCommand);
    expect(command.input.ConnectionId).toBe("conn-1");
    expect(new TextDecoder().decode(command.input.Data as Uint8Array)).toBe('{"type":"changed"}');
  });

  it("相手がもういない(410)なら gone", async () => {
    const sender = createApiGatewaySender(client(async () => Promise.reject(gone())));
    expect(await sender.send("conn-1", { type: "pong" })).toBe("gone");
  });

  it("ほかの失敗は投げる(呼ぶ側が記録する)", async () => {
    const sender = createApiGatewaySender(
      client(async () => Promise.reject(new Error("throttled"))),
    );
    await expect(sender.send("conn-1", { type: "pong" })).rejects.toThrow("throttled");
  });

  it("切るときは DeleteConnection。もういなければ何もしない", async () => {
    const c = client(async () => ({}));
    await createApiGatewaySender(c).close("conn-1");
    const command = c.send.mock.calls[0]?.[0] as DeleteConnectionCommand;
    expect(command).toBeInstanceOf(DeleteConnectionCommand);
    expect(command.input.ConnectionId).toBe("conn-1");

    const already = createApiGatewaySender(client(async () => Promise.reject(gone())));
    await expect(already.close("conn-1")).resolves.toBeUndefined();
  });
});
