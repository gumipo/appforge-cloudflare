# AppForge

チャットでアイデアを伝えると、動くWebアプリを生成し、Cloudflare Workersへ公開して、OGP画像付きのギャラリーに並べるMVPです。

![AppForge architecture](https://img.shields.io/badge/Cloudflare-Workers%20%7C%20D1%20%7C%20Queues%20%7C%20R2%20%7C%20Browser%20Run-F38020?style=flat-square)

## できること

- チャットから自己完結型HTMLアプリを生成
- ローカルでは外部キーなしの決定的テンプレート生成
- 本番ではWorkers AIを使ったUI生成
- D1にアプリ、会話、ビルド履歴を保存
- Queuesで生成・デプロイを非同期実行
- Cloudflare APIで生成アプリを個別Workerとして公開
- Browser Runで1200×630のOGP画像を撮影し、R2へ保存
- 生成アプリの一覧、ライブプレビュー、追加指示による再生成
- `/apps/:slug` に動的OGPメタデータを挿入

## ローカルで起動

必要なものはNode.js 20以降です。ローカルモードではCloudflareへのログインやAPIキーは不要です。

```bash
npm install
npm run dev
```

- Web UI: <http://localhost:5173>
- Worker API: <http://localhost:8787>
- 初回起動時にローカルD1マイグレーションが自動適用されます。

`npm run dev` はViteとWranglerを同時に起動します。ローカル生成物は同一Workerの `/preview/:id` で配信され、サムネイルはローカルR2へ保存されます。

## 構成

```text
Browser / React UI
        │
        ▼
AppForge Worker (Hono)
  ├─ D1: apps / messages / builds
  ├─ Queue: build jobs
  ├─ Workers AI: self-contained HTML generation
  ├─ Cloudflare Workers API: generated Worker upload
  ├─ Browser Run: 1200×630 screenshot
  └─ R2: OGP image storage
```

MCPはこのリポジトリの作成・運用を支援する開発側のインターフェースです。実際のAppForgeサービスは、ユーザーのリクエストごとにMCPクライアントを起動せず、CloudflareのbindingsとREST APIを直接利用します。

## 本番Cloudflareの準備

1. Cloudflareへログインします。

   ```bash
   npx wrangler login
   ```

2. リソースを作ります。

   ```bash
   npx wrangler d1 create appforge-db
   npx wrangler r2 bucket create appforge-thumbnails
   npx wrangler queues create appforge-builds
   npx wrangler queues create appforge-builds-dlq
   ```

3. D1作成結果の`database_id`を `wrangler.jsonc` の `REPLACE_WITH_D1_DATABASE_ID` と置き換えます。

4. 生成Workerを公開するための値をSecretsへ登録します。

   ```bash
   npx wrangler secret put CLOUDFLARE_ACCOUNT_ID
   npx wrangler secret put CLOUDFLARE_API_TOKEN
   npx wrangler secret put CF_WORKERS_SUBDOMAIN
   ```

   API Tokenには最小限 `Workers Scripts: Edit` 相当の権限を付けます。`CF_WORKERS_SUBDOMAIN` は `.workers.dev` を除いたアカウントのサブドメインです。

5. DBを初期化してデプロイします。

   ```bash
   npm run db:migrate:remote
   npm run deploy
   ```

本番のWorkers AIとBrowser Runは `wrangler.jsonc` のbindingsで有効になります。現在のモデルは `@cf/meta/llama-3.3-70b-instruct-fp8-fast` で、`AI_MODEL`から変更できます。

## 品質チェック

```bash
npm run typecheck
npm test
npm run build
```

## セキュリティ上の境界

- 生成対象は500KB以下のHTML/CSS/JSに限定しています。
- 生成アプリは通信を禁止するCSP付きで、管理画面では`allow-same-origin`なしのsandbox iframeに表示します。
- ユーザー入力をWorkerソースとして直接評価せず、信頼済みの配信ラッパーへHTML文字列として埋め込みます。
- API TokenはWorker Secretとして保存し、クライアントへ返しません。

このMVPは匿名・単一ワークスペース向けです。一般公開前にCloudflare Access/Auth、ユーザー単位の所有権、レート制限、コンテンツモデレーション、クォータ、Worker削除ライフサイクルを追加してください。大量のユーザーコードを運用する段階では、アカウント直下にWorkerを増やす方式から **Cloudflare Workers for Platforms / dispatch namespace** へ移行するのが適切です。

