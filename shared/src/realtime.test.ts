import { describe, expect, it } from "vitest";
import { parseClientMessage, parseServerMessage } from "./realtime.js";

describe("画面 → サーバーのメッセージ", () => {
  it.each([
    { type: "hello" },
    { type: "ping" },
    { type: "editing", itemId: "01M80R6PAEC5SRJ6T4G8G8B1XZ" },
    { type: "editing", itemId: null },
  ])("正しい形は読める %o", (message) => {
    expect(parseClientMessage(JSON.stringify(message))).toEqual(message);
  });

  it.each([
    ["JSON でない", "{"],
    ["知らない種類", JSON.stringify({ type: "changed" })],
    ["余分な項目(利用者のなりすまし)", JSON.stringify({ type: "hello", userId: "u-other" })],
    ["予定の ID の形が違う", JSON.stringify({ type: "editing", itemId: "a#b" })],
    ["1KB を超える", JSON.stringify({ type: "ping" }) + " ".repeat(1024)],
  ])("%s ものは捨てる", (_label, raw) => {
    expect(parseClientMessage(raw)).toBeNull();
  });
});

describe("サーバー → 画面のメッセージ", () => {
  it.each([
    { type: "changed" },
    { type: "revoked" },
    { type: "pong" },
    {
      type: "presence",
      seq: 3,
      people: [{ userId: "u", displayName: "たろう" }],
      editing: [{ itemId: "i", userId: "u", displayName: "たろう" }],
    },
  ])("正しい形は読める %o", (message) => {
    expect(parseServerMessage(JSON.stringify(message))).toEqual(message);
  });

  it("知らない形は捨てる", () => {
    expect(parseServerMessage('{"type":"presence"}')).toBeNull();
    expect(parseServerMessage("x")).toBeNull();
  });
});
