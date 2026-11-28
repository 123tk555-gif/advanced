import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AssetHashType,
  aws_apigatewayv2 as apigw,
  aws_apigatewayv2_authorizers as authorizers,
  aws_budgets as budgets,
  CfnOutput,
  aws_cloudfront as cloudfront,
  aws_cognito as cognito,
  DockerImage,
  Duration,
  aws_dynamodb as dynamodb,
  aws_apigatewayv2_integrations as integrations,
  aws_lambda as lambda,
  aws_logs as logs,
  aws_cloudfront_origins as origins,
  RemovalPolicy,
  Stack,
  type StackProps,
  aws_s3 as s3,
} from "aws-cdk-lib";
import type { Construct } from "constructs";
import { buildSync } from "esbuild";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * API の入口(api/src/…)を 1 つのファイルにまとめた Lambda のコード。
 * CDK のまとめ機能は pnpm のコマンドを探すため、esbuild を直接呼ぶ(Windows でも CI でも同じに動く)。
 */
export function bundleApiEntry(entry: string, outputDir: string): void {
  buildSync({
    entryPoints: [join(repoRoot, "api", "src", entry)],
    outfile: join(outputDir, "index.mjs"),
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    minify: true,
    sourcemap: true,
    logLevel: "warning",
    // まとめた ESM の中で、CommonJS の部品が require を使えるようにする
    banner: {
      js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
    },
  });
}

function apiCode(entry: string): lambda.Code {
  return lambda.Code.fromAsset(join(repoRoot, "api"), {
    // まとめた結果で変わったかを判断する(shared など、ほかのフォルダの変更も拾える)
    assetHashType: AssetHashType.OUTPUT,
    bundling: {
      image: DockerImage.fromRegistry("unused"),
      // CDK は同じ場所・同じ設定のまとめを使い回すので、入口を設定に含めて別物にする
      command: ["bundle", entry],
      local: {
        tryBundle(outputDir) {
          bundleApiEntry(entry, outputDir);
          return true;
        },
      },
    },
  });
}

export interface TriTriStackProps extends StackProps {
  /** 予算の通知(アカウント全体で月 5 ドル)の送り先。無ければ予算の通知は作らない */
  budgetEmail?: string;
}

/**
 * Tri-Tri の本番一式(東京リージョン)。
 * 画面: S3 + CloudFront / API: HTTP API + Lambda / リアルタイム更新: WebSocket API + Lambda
 * ログイン: Cognito / データ: DynamoDB(Main と Connections)
 */
export class TriTriStack extends Stack {
  constructor(scope: Construct, id: string, props: TriTriStackProps = {}) {
    super(scope, id, props);

    // ---- データ ----
    // 旅のデータ。消すと戻せないので、スタックを消しても残し、復元用のバックアップも取る
    const main = new dynamodb.Table(this, "Main", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    main.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    // 接続・チケット・番号。期限(ttl)が来たら自動で消える。消えても困らないので、スタックと一緒に消す
    const connections = new dynamodb.Table(this, "Connections", {
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "ttl",
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // ---- ログイン ----
    const userPool = new cognito.UserPool(this, "Users", {
      featurePlan: cognito.FeaturePlan.LITE,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      // 画面の確認(web/app/utils/auth/validate.ts)と合わせる: 10 文字以上、文字の種類は問わない
      passwordPolicy: {
        minLength: 10,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      userVerification: {
        emailSubject: "Tri-Tri の確認コード",
        emailBody:
          "Tri-Tri の確認コードは {####} です。画面に入れて、メールアドレスの確認を終えてください。心当たりがなければ、このメールは捨ててください。",
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const client = userPool.addClient("Web", {
      generateSecret: false,
      // パスワードは SRP で確かめ、そのものは送らない
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });

    // ---- 画面の配信 ----
    const site = new s3.Bucket(this, "Site", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const headers = new cloudfront.ResponseHeadersPolicy(this, "SecurityHeaders", {
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(730),
          includeSubdomains: true,
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
      },
    });
    const distribution = new cloudfront.Distribution(this, "Cdn", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(site),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: headers,
      },
      // 画面の中の URL(/trips/… など)はファイルが無いので、index.html を返して画面側で開く
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 200,
        responsePagePath: "/index.html",
        ttl: Duration.seconds(0),
      })),
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    });
    const webOrigin = `https://${distribution.distributionDomainName}`;

    // ---- リアルタイム更新(WebSocket) ----
    const wsApi = new apigw.WebSocketApi(this, "Ws");
    // 接続の URL にチケットが入るので、アクセスログは取らない
    const wsStage = new apigw.WebSocketStage(this, "WsStage", {
      webSocketApi: wsApi,
      stageName: "prod",
      autoDeploy: true,
      throttle: { rateLimit: 50, burstLimit: 100 },
    });

    // ---- Lambda ----
    const environment = {
      TABLE_NAME: main.tableName,
      CONNECTIONS_TABLE: connections.tableName,
      WS_ENDPOINT: wsStage.callbackUrl,
      WEB_ORIGIN: webOrigin,
      NODE_OPTIONS: "--enable-source-maps",
    };
    const fn = (id: string, entry: string, timeout: Duration) => {
      const f = new lambda.Function(this, id, {
        code: apiCode(entry),
        handler: "index.handler",
        runtime: lambda.Runtime.NODEJS_24_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 1024,
        timeout,
        environment,
        logGroup: new logs.LogGroup(this, `${id}Logs`, {
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
      });
      main.grantReadWriteData(f);
      connections.grantReadWriteData(f);
      wsApi.grantManageConnections(f);
      return f;
    };
    // API Gateway HTTP API の上限は 30 秒。それより少し短くする
    const apiFn = fn("ApiFn", "lambda.ts", Duration.seconds(29));
    const wsFn = fn("WsFn", "ws-lambda.ts", Duration.seconds(10));

    const wsIntegration = new integrations.WebSocketLambdaIntegration("WsIntegration", wsFn);
    wsApi.addRoute("$connect", { integration: wsIntegration });
    wsApi.addRoute("$disconnect", { integration: wsIntegration });
    wsApi.addRoute("$default", { integration: wsIntegration });

    // ---- API(HTTP API) ----
    const httpApi = new apigw.HttpApi(this, "Api", {
      createDefaultStage: false,
      corsPreflight: {
        allowOrigins: [webOrigin],
        allowHeaders: ["authorization", "content-type"],
        allowMethods: [
          apigw.CorsHttpMethod.GET,
          apigw.CorsHttpMethod.POST,
          apigw.CorsHttpMethod.PUT,
          apigw.CorsHttpMethod.PATCH,
          apigw.CorsHttpMethod.DELETE,
        ],
        maxAge: Duration.minutes(10),
      },
    });
    const apiStage = httpApi.addStage("DefaultStage", {
      stageName: "$default",
      autoDeploy: true,
      // 使いすぎを防ぐ上限(課題の規模なら十分)
      throttle: { rateLimit: 50, burstLimit: 100 },
    });
    const apiIntegration = new integrations.HttpLambdaIntegration("ApiIntegration", apiFn);
    const jwt = new authorizers.HttpJwtAuthorizer(
      "Cognito",
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      { jwtAudience: [client.userPoolClientId] },
    );
    httpApi.addRoutes({
      path: "/{proxy+}",
      methods: [apigw.HttpMethod.ANY],
      integration: apiIntegration,
      authorizer: jwt,
    });
    // 公開しおりだけは、ログインなしで読める
    httpApi.addRoutes({
      path: "/public/{token}",
      methods: [apigw.HttpMethod.GET],
      integration: apiIntegration,
    });

    // ---- 予算の通知 ----
    if (props.budgetEmail) {
      const to = [{ address: props.budgetEmail, subscriptionType: "EMAIL" }];
      new budgets.CfnBudget(this, "Budget", {
        budget: {
          // アカウント全体(同じアカウントの taskboard も含む)。Tri-Tri だけに絞るには、
          // 請求の画面でタグ app を「コスト配分タグ」として有効にする必要があるため
          budgetName: "monthly-5usd-tritri-account",
          budgetType: "COST",
          timeUnit: "MONTHLY",
          budgetLimit: { amount: 5, unit: "USD" },
        },
        notificationsWithSubscribers: [
          {
            notification: {
              notificationType: "ACTUAL",
              comparisonOperator: "GREATER_THAN",
              threshold: 80,
              thresholdType: "PERCENTAGE",
            },
            subscribers: to,
          },
          {
            notification: {
              notificationType: "FORECASTED",
              comparisonOperator: "GREATER_THAN",
              threshold: 100,
              thresholdType: "PERCENTAGE",
            },
            subscribers: to,
          },
        ],
      });
    }

    // ---- 画面を作るのに要る値 ----
    new CfnOutput(this, "SiteUrl", { value: webOrigin });
    new CfnOutput(this, "ApiUrl", { value: apiStage.url.replace(/\/$/, "") });
    new CfnOutput(this, "WsUrl", { value: wsStage.url });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: client.userPoolClientId });
    new CfnOutput(this, "SiteBucket", { value: site.bucketName });
    new CfnOutput(this, "DistributionId", { value: distribution.distributionId });
  }
}
