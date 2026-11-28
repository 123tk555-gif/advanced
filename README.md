# Tri-Tri(トリトリ)

友人や家族と、1 つの旅のしおりを全員で同時に作る Web アプリ。旅程・行きたい場所の投票・割り勘・コメントを、メンバー同士がリアルタイムにやり取りする。予定の場所は Google マップで地図と経路を表示する。

講義の課題「複数のユーザーが情報を双方向にやり取りし、共有する Web アプリ」として作っている。

## 構成
| 層 | 使うもの |
|---|---|
| 画面 | Nuxt 4(Vue 3、TypeScript)。ブラウザだけで動く画面(SPA) |
| API | Hono(TypeScript)。本番は API Gateway + Lambda、手元は開発用サーバー |
| データベース | DynamoDB(手元は DynamoDB Local) |
| リアルタイム | WebSocket(本番は API Gateway WebSocket、手元は開発用サーバー) |
| 地図 | Google マップ(キーが無ければ仮の地図で動く) |
| テスト | Vitest、Playwright、k6 |

| フォルダ | 中身 |
|---|---|
| `web/` | 画面 |
| `api/` | API |
| `shared/` | 画面と API で共通の入力のルール・計算 |
| `e2e/` | ブラウザでの操作テスト |
| `infra/` | AWS の構築(CDK)と、画面を上げる手順 |
| `load/` | 負荷試験 |
| `docs/` | 要件定義書・データ設計・画面一覧・テスト計画書・テスト結果報告書 |

## 手元で動かす
必要なもの: Node.js 24 以上、Docker Desktop。

```sh
corepack pnpm install
docker compose up -d dynamodb   # 開発用 DB(このパソコンの中からだけつながる)
corepack pnpm dev:api           # API: http://127.0.0.1:8787
corepack pnpm dev:web           # 画面: http://localhost:3000
```

手元のログインは開発用の仮のもので、利用者 ID と表示名を入れるだけで入れる(本番は Cognito のメールとパスワード)。タブごとに別の ID を使うと、別の人として試せる。
DB はメモリ上なので、コンテナを止めるとデータは消える。

Google マップを使うときは、[Googleマップの設定.md](docs/Googleマップの設定.md) のとおりにキーを作り、`web/.env` に書く(git には入れない)。

## テスト
| コマンド | 内容 | 前提 |
|---|---|---|
| `corepack pnpm test` | 単体・API の結合テスト | 開発用 DB |
| `corepack pnpm lint` / `corepack pnpm typecheck` | 書き方・型の検査 | |
| `corepack pnpm test:e2e` | ブラウザでの操作テスト(Chromium) | 開発用 DB |
| `corepack pnpm --filter @tritri/e2e test:auth` | メールとパスワードのログインの操作テスト(試験用のログインで) | 開発用 DB |
| `corepack pnpm --filter @tritri/e2e test:all` | 同じテストを Chromium・Firefox・WebKit・スマートフォン幅で | 開発用 DB |
| `node load/run.mjs <名前> [L1 ... L8]` | 負荷試験(結果は `load/results/<名前>/`) | Docker |

- ブラウザでの操作テストは、開発用サーバー(3000・8787)を動かしたままでも流せる(テスト専用のポートと作業フォルダを使う)
- 負荷試験は専用の DB(127.0.0.1:8001)と API(127.0.0.1:8790)を立てて流し、終わったら片付ける。普段のデータ・Google・AWS には負荷をかけない。全部で約 1.5 時間、その間はパソコンが重くなる
- Windows で Firefox を使うとき、Playwright の部品の確認が `msvcp140_1.dll` で止まることがある。ブラウザ自体は動くので、`PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1` を付けて流す
- 本番用ビルド(`corepack pnpm --filter @tritri/web build`)は、`pnpm dev:web` を止めてから行う(動いている開発用サーバーが落ちることがある)

GitHub Actions で、押すたびに lint・型・テスト・ビルド・脆弱性検査と、4 つの環境のブラウザでの操作テストを流す。

## AWS に公開する
東京リージョン(ap-northeast-1)に、スタック `TriTri` として作る。資源にはすべてタグ `app=tritri` が付く。

| 層 | AWS |
|---|---|
| 画面 | S3(非公開)+ CloudFront |
| API | API Gateway HTTP API(Cognito の JWT を確かめる)+ Lambda |
| リアルタイム | API Gateway WebSocket API + Lambda |
| ログイン | Cognito(メールとパスワード、確認コードはメール) |
| データ | DynamoDB(Main は消さない設定・復元用のバックアップあり、Connections は期限で自動で消える) |

```sh
aws sso login --profile <プロファイル>
corepack pnpm --filter @tritri/infra exec cdk diff --profile <プロファイル>     # 作る・変わる資源を確かめる
corepack pnpm --filter @tritri/infra exec cdk deploy --profile <プロファイル>
node infra/deploy-web.mjs --profile <プロファイル>                               # 画面を作って上げる(--dry-run で試し)
corepack pnpm --filter @tritri/infra smoke --profile <プロファイル>               # 公開の後の確かめ(読むだけ。deploy-web の最後にも流れる)
```

- 初めてのアカウント・リージョンでは、先に `cdk bootstrap` が要る
- 予算の通知(アカウント全体で月 5 ドル)を作るときは `-c budgetEmail=<通知先>` を付けて deploy する
- Google マップのキーには、公開した URL(`https://xxxx.cloudfront.net/*`)をリファラーに足す([Googleマップの設定.md](docs/Googleマップの設定.md))
- 画面を上げる前に `pnpm dev:web` を止める(本番用ビルドをするため)
- `corepack pnpm --filter @tritri/infra test` で、作る資源の形を確かめる(AWS にはつながない)
- 公開の後の確かめは、画面・ブラウザの下見(CORS)・ログインが要る道の 401・API と WebSocket の Lambda が動いているか、を読むだけで確かめる(データは作らず、メールも送らない)。`cdk deploy` の後にも流す

## 文書
- [要件定義書](docs/要件定義書.md)・[データ設計](docs/データ設計.md)・[画面一覧](docs/画面一覧.md)
- [テスト計画書](docs/テスト計画書.md)・[テスト結果報告書](docs/テスト結果報告書.md)
- [Google マップの設定](docs/Googleマップの設定.md)
