import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, it } from "vitest";
import { TriTriStack } from "../lib/stack.js";

/**
 * 作る AWS の資源の形を確かめる(テンプレートを作るだけで、AWS にはつながない)。
 * Lambda のまとめ(esbuild)も走るので、少し時間がかかる。
 */
function synth(props: { budgetEmail?: string } = {}) {
  const app = new App();
  const stack = new TriTriStack(app, "TriTriTest", {
    env: { account: "123456789012", region: "ap-northeast-1" },
    ...props,
  });
  return Template.fromStack(stack);
}

let t: Template;
beforeAll(() => {
  t = synth();
}, 300_000);

const resourcesOf = (type: string) => Object.values(t.findResources(type));

describe("DynamoDB", () => {
  it("Main: PK/SK と GSI1。使った分だけの料金、復元用のバックアップ、消さない設定", () => {
    t.hasResource("AWS::DynamoDB::Table", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
      Properties: Match.objectLike({
        BillingMode: "PAY_PER_REQUEST",
        KeySchema: [
          { AttributeName: "PK", KeyType: "HASH" },
          { AttributeName: "SK", KeyType: "RANGE" },
        ],
        GlobalSecondaryIndexes: [
          Match.objectLike({
            IndexName: "GSI1",
            KeySchema: [
              { AttributeName: "GSI1PK", KeyType: "HASH" },
              { AttributeName: "GSI1SK", KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "ALL" },
          }),
        ],
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        DeletionProtectionEnabled: true,
      }),
    });
  });

  it("Connections: 期限(ttl)が来た項目は自動で消える", () => {
    t.hasResourceProperties("AWS::DynamoDB::Table", {
      KeySchema: [
        { AttributeName: "PK", KeyType: "HASH" },
        { AttributeName: "SK", KeyType: "RANGE" },
      ],
      TimeToLiveSpecification: { AttributeName: "ttl", Enabled: true },
    });
  });
});

describe("Cognito", () => {
  it("メールアドレスでログイン、自分で登録、確認コードはメール。パスワードは 10 文字以上で種類は問わない", () => {
    t.hasResource("AWS::Cognito::UserPool", {
      DeletionPolicy: "Retain",
      Properties: Match.objectLike({
        UsernameAttributes: ["email"],
        AutoVerifiedAttributes: ["email"],
        AdminCreateUserConfig: { AllowAdminCreateUserOnly: false },
        DeletionProtection: "ACTIVE",
        Policies: {
          PasswordPolicy: Match.objectLike({
            MinimumLength: 10,
            RequireLowercase: false,
            RequireUppercase: false,
            RequireNumbers: false,
            RequireSymbols: false,
          }),
        },
        AccountRecoverySetting: {
          RecoveryMechanisms: [{ Name: "verified_email", Priority: 1 }],
        },
      }),
    });
  });

  it("画面用のクライアント: 秘密の鍵なし、SRP だけ、登録の有無を知られない", () => {
    const [client] = resourcesOf("AWS::Cognito::UserPoolClient");
    const p = client?.Properties;
    expect(p.GenerateSecret).toBe(false);
    expect([...p.ExplicitAuthFlows].sort()).toEqual([
      "ALLOW_REFRESH_TOKEN_AUTH",
      "ALLOW_USER_SRP_AUTH",
    ]);
    expect(p.PreventUserExistenceErrors).toBe("ENABLED");
    expect(p.EnableTokenRevocation).toBe(true);
  });
});

describe("HTTP API", () => {
  it("公開しおりだけはログインなし。ほかはすべて Cognito の JWT を確かめる", () => {
    const routes = resourcesOf("AWS::ApiGatewayV2::Route").filter(
      (r) => !String(r.Properties.RouteKey).startsWith("$"),
    );
    const byKey = Object.fromEntries(routes.map((r) => [r.Properties.RouteKey, r.Properties]));
    const methods = ["DELETE", "GET", "PATCH", "POST", "PUT"];
    expect(Object.keys(byKey).sort()).toEqual(
      [...methods.map((m) => `${m} /{proxy+}`), "GET /public/{token}"].sort(),
    );
    for (const m of methods) expect(byKey[`${m} /{proxy+}`].AuthorizationType).toBe("JWT");
    expect(byKey["GET /public/{token}"].AuthorizationType).toBe("NONE");
    t.hasResourceProperties("AWS::ApiGatewayV2::Authorizer", {
      AuthorizerType: "JWT",
      IdentitySource: ["$request.header.Authorization"],
      JwtConfiguration: Match.objectLike({ Audience: [Match.anyValue()] }),
    });
  });

  it("ブラウザの下見(OPTIONS)は JWT の確認に回さない(回すと 401 になり、画面が API を呼べない)", () => {
    const keys = resourcesOf("AWS::ApiGatewayV2::Route").map((r) => String(r.Properties.RouteKey));
    expect(keys.filter((k) => k.startsWith("ANY ") || k.startsWith("OPTIONS "))).toEqual([]);
  });

  it("CORS は CloudFront の画面からだけ", () => {
    const [api] = resourcesOf("AWS::ApiGatewayV2::Api").filter(
      (a) => a.Properties.ProtocolType === "HTTP",
    );
    const cors = api?.Properties.CorsConfiguration;
    expect(JSON.stringify(cors.AllowOrigins)).toContain("DomainName");
    expect(cors.AllowHeaders).toEqual(["authorization", "content-type"]);
  });

  it("使いすぎを防ぐため、流量に上限をかける", () => {
    t.hasResourceProperties("AWS::ApiGatewayV2::Stage", {
      StageName: "$default",
      DefaultRouteSettings: Match.objectLike({
        ThrottlingRateLimit: Match.anyValue(),
        ThrottlingBurstLimit: Match.anyValue(),
      }),
    });
  });
});

describe("WebSocket API", () => {
  it("$connect・$disconnect・$default を WebSocket の Lambda へ", () => {
    const keys = resourcesOf("AWS::ApiGatewayV2::Route")
      .map((r) => r.Properties.RouteKey)
      .filter((k: string) => k.startsWith("$"))
      .sort();
    expect(keys).toEqual(["$connect", "$default", "$disconnect"]);
  });

  it("接続の URL の記録(アクセスログ)を取らない(チケットが残らないように)", () => {
    for (const stage of resourcesOf("AWS::ApiGatewayV2::Stage")) {
      expect(stage.Properties.AccessLogSettings).toBeUndefined();
    }
  });
});

describe("Lambda", () => {
  it("API と WebSocket は、それぞれ別の入口をまとめたコード(同じまとめを使い回さない)", () => {
    const keys = resourcesOf("AWS::Lambda::Function")
      .filter((f) => f.Properties.Environment?.Variables?.TABLE_NAME)
      .map((f) => f.Properties.Code.S3Key);
    expect(new Set(keys).size).toBe(2);
  });

  it("API と WebSocket の 2 つ。Node.js 24、同じ設定を環境変数で渡す", () => {
    const fns = resourcesOf("AWS::Lambda::Function").filter(
      (f) => f.Properties.Environment?.Variables?.TABLE_NAME,
    );
    expect(fns).toHaveLength(2);
    for (const fn of fns) {
      expect(fn.Properties.Runtime).toBe("nodejs24.x");
      expect(Object.keys(fn.Properties.Environment.Variables).sort()).toEqual(
        expect.arrayContaining(["CONNECTIONS_TABLE", "TABLE_NAME", "WEB_ORIGIN", "WS_ENDPOINT"]),
      );
    }
  });
});

describe("画面の配信(S3 + CloudFront)", () => {
  it("S3 は非公開。CloudFront からだけ読める", () => {
    t.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    t.resourceCountIs("AWS::CloudFront::OriginAccessControl", 1);
  });

  it("https だけ。画面の中の URL(/trips/… など)は index.html で開く。安全のヘッダーを付ける", () => {
    t.hasResourceProperties("AWS::CloudFront::Distribution", {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: "index.html",
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: "redirect-to-https" }),
        CustomErrorResponses: Match.arrayWith([
          Match.objectLike({ ErrorCode: 403, ResponseCode: 200, ResponsePagePath: "/index.html" }),
          Match.objectLike({ ErrorCode: 404, ResponseCode: 200, ResponsePagePath: "/index.html" }),
        ]),
      }),
    });
    t.hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          StrictTransportSecurity: Match.objectLike({ Override: true }),
          ContentTypeOptions: { Override: true },
          FrameOptions: { FrameOption: "DENY", Override: true },
        }),
      }),
    });
  });
});

describe("出力と予算", () => {
  it("画面を作るのに要る値を出力する", () => {
    const outputs = Object.keys(t.toJSON().Outputs ?? {});
    for (const name of [
      "ApiUrl",
      "WsUrl",
      "UserPoolId",
      "UserPoolClientId",
      "SiteBucket",
      "DistributionId",
      "SiteUrl",
    ]) {
      expect(outputs).toContain(name);
    }
  });

  it("予算の通知は、通知先のメールを渡したときだけ作る", () => {
    t.resourceCountIs("AWS::Budgets::Budget", 0);
    const withBudget = synth({ budgetEmail: "owner@example.com" });
    withBudget.hasResourceProperties("AWS::Budgets::Budget", {
      Budget: Match.objectLike({ BudgetType: "COST", TimeUnit: "MONTHLY" }),
    });
  }, 300_000);
});

describe("Lambda のコードのまとめ", () => {
  it("まとめた API と WebSocket の入口が、Node.js でそのまま読み込める", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { pathToFileURL } = await import("node:url");
    const { bundleApiEntry } = await import("../lib/stack.js");
    Object.assign(process.env, {
      TABLE_NAME: "t",
      WEB_ORIGIN: "https://example.cloudfront.net",
      CONNECTIONS_TABLE: "c",
      WS_ENDPOINT: "https://abc.execute-api.ap-northeast-1.amazonaws.com/prod",
      AWS_REGION: "ap-northeast-1",
    });
    for (const entry of ["lambda.ts", "ws-lambda.ts"]) {
      const out = mkdtempSync(join(tmpdir(), "tritri-bundle-"));
      bundleApiEntry(entry, out);
      const mod = await import(pathToFileURL(join(out, "index.mjs")).href);
      expect(typeof mod.handler, entry).toBe("function");
    }
  });
});
