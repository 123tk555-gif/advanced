# Tri-Tri(トリトリ)

友人や家族と、1 つの旅のしおりを全員で同時に作る Web アプリ。旅程・行きたい場所の投票・割り勘・コメントを、メンバー同士がリアルタイムにやり取りする。予定の場所は Google マップで地図と経路を表示する。

講義の課題「複数のユーザーが情報を双方向にやり取りし、共有する Web アプリ」として作っている。今は手元で動く段階で、AWS への公開はこれから。

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

ログインは開発用の仮のもので、利用者 ID と表示名を入れるだけで入れる。タブごとに別の ID を使うと、別の人として試せる。
DB はメモリ上なので、コンテナを止めるとデータは消える。

Google マップを使うときは、[Googleマップの設定.md](docs/Googleマップの設定.md) のとおりにキーを作り、`web/.env` に書く(git には入れない)。

## テスト
| コマンド | 内容 | 前提 |
|---|---|---|
| `corepack pnpm test` | 単体・API の結合テスト | 開発用 DB |
| `corepack pnpm lint` / `corepack pnpm typecheck` | 書き方・型の検査 | |
| `corepack pnpm test:e2e` | ブラウザでの操作テスト(Chromium) | 開発用 DB |
| `corepack pnpm --filter @tritri/e2e test:all` | 同じテストを Chromium・Firefox・WebKit・スマートフォン幅で | 開発用 DB |
| `node load/run.mjs <名前> [L1 ... L8]` | 負荷試験(結果は `load/results/<名前>/`) | Docker |

- ブラウザでの操作テストは、開発用サーバー(3000・8787)を動かしたままでも流せる(テスト専用のポートと作業フォルダを使う)
- 負荷試験は専用の DB(127.0.0.1:8001)と API(127.0.0.1:8790)を立てて流し、終わったら片付ける。普段のデータ・Google・AWS には負荷をかけない。全部で約 1.5 時間、その間はパソコンが重くなる
- Windows で Firefox を使うとき、Playwright の部品の確認が `msvcp140_1.dll` で止まることがある。ブラウザ自体は動くので、`PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1` を付けて流す
- 本番用ビルド(`corepack pnpm --filter @tritri/web build`)は、`pnpm dev:web` を止めてから行う(動いている開発用サーバーが落ちることがある)

GitHub Actions で、押すたびに lint・型・テスト・ビルド・脆弱性検査と、4 つの環境のブラウザでの操作テストを流す。

## 文書
- [要件定義書](docs/要件定義書.md)・[データ設計](docs/データ設計.md)・[画面一覧](docs/画面一覧.md)
- [テスト計画書](docs/テスト計画書.md)・[テスト結果報告書](docs/テスト結果報告書.md)
- [Google マップの設定](docs/Googleマップの設定.md)
