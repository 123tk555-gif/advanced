import { describe, expect, it } from "vitest";
import { readAwsConfig } from "../src/aws-config.js";

const full = {
  TABLE_NAME: "tritri-main",
  CONNECTIONS_TABLE: "tritri-connections",
  WS_ENDPOINT: "https://abc.execute-api.ap-northeast-1.amazonaws.com/prod",
  WEB_ORIGIN: "https://d111.cloudfront.net",
};

describe("本番(Lambda)の設定を環境変数から読む", () => {
  it("すべてあれば、リアルタイム更新も使う", () => {
    expect(readAwsConfig(full)).toEqual({
      tableName: "tritri-main",
      webOrigin: "https://d111.cloudfront.net",
      realtime: {
        connectionsTable: "tritri-connections",
        wsEndpoint: "https://abc.execute-api.ap-northeast-1.amazonaws.com/prod",
      },
    });
  });

  it("WebSocket の設定がどちらも無ければ、リアルタイム更新なしで動く", () => {
    const { CONNECTIONS_TABLE, WS_ENDPOINT, ...rest } = full;
    expect(readAwsConfig(rest).realtime).toBeNull();
  });

  it("足りない・半分だけの設定は、起動の時点で止める(気づかないまま動かさない)", () => {
    const { TABLE_NAME, ...noTable } = full;
    expect(() => readAwsConfig(noTable)).toThrow("TABLE_NAME");
    const { WEB_ORIGIN, ...noOrigin } = full;
    expect(() => readAwsConfig(noOrigin)).toThrow("WEB_ORIGIN");
    const { WS_ENDPOINT, ...half } = full;
    expect(() => readAwsConfig(half)).toThrow("CONNECTIONS_TABLE と WS_ENDPOINT");
  });

  it("WebSocket の送り先は https の URL だけ", () => {
    expect(() => readAwsConfig({ ...full, WS_ENDPOINT: "wss://abc/prod" })).toThrow("WS_ENDPOINT");
  });
});
