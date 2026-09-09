# Production setup

## 0. Free mode (default)

通常の`wrangler.jsonc`は`FREE_TIER_ONLY=true`です。このモードでは生成アプリをAppForge本体の`/preview/...`から配信し、個別Workerのupload、Workers for Platforms、Browser Renderingをコード側で無効化します。OGPにはR2へ保存するSVGを使います。

したがって無料モードでは`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`CF_WORKERS_SUBDOMAIN`、`WFP_NAMESPACE`は不要です。Claudeを使う場合のAnthropic API利用料はCloudflareとは別です。

## 1. Cloudflare resources

```bash
npx wrangler login
npx wrangler d1 create appforge-db
npx wrangler r2 bucket create appforge-thumbnails
npx wrangler queues create appforge-builds
npx wrangler queues create appforge-builds-dlq
```

このリポジトリには作成済み`appforge-db`のIDが設定されています。別アカウントへ複製する場合だけ、D1作成時に返るIDへ差し替えます。

## 2. Authentication

Cloudflare Zero TrustでAppForgeのhostnameを保護するAccess self-hosted applicationを作り、次をSecretsへ設定します。

```bash
npx wrangler secret put CF_ACCESS_TEAM_DOMAIN
npx wrangler secret put CF_ACCESS_AUD
```

`CF_ACCESS_TEAM_DOMAIN`は`your-team.cloudflareaccess.com`、`CF_ACCESS_AUD`はAccess application audienceです。管理画面と社内向け生成アプリのURLをAccess policyの対象にしてください。

## 3. Claude

Anthropicを直接使う場合:

```bash
npx wrangler secret put ANTHROPIC_API_KEY
```

Cloudflare AI Gateway経由の場合は`ANTHROPIC_BASE_URL`を環境変数へ設定し、認証済みGatewayなら次も登録します。

```bash
npx wrangler secret put AI_GATEWAY_TOKEN
npx wrangler secret put ANTHROPIC_API_KEY
```

既定モデルは`claude-sonnet-5`です。変更する場合は`ANTHROPIC_MODEL`を更新します。

## 4. Generated Worker upload credentials (optional paid mode only)

`FREE_TIER_ONLY=false`へ明示的に変更し、AppForge Workerから生成Workerをアップロードする場合だけ、専用の最小権限API Tokenを作成します。日常利用のユーザーOAuth tokenは保存しません。

```bash
npx wrangler secret put CLOUDFLARE_API_TOKEN
```

Account IDとworkers.dev subdomainは有料モード用の`wrangler.platform.jsonc`にだけ設定されています。別アカウントへ複製する場合は同ファイルを更新します。

通常のWorkers構成ではWorkers Scriptsの編集権限、Workers for Platforms構成ではdispatch namespaceのscript uploadに必要な権限だけを付けてください。

`PUBLIC_GENERATED_WORKERS`は安全のため`false`です。この場合、生成Workerの`workers.dev` URLは無効化され、Accessで保護したAppForge WorkerのプレビューURLから配信します。公開サイトを作る用途でのみ、公開範囲を確認して`true`へ変更してください。

## 5. Deploy

無料構成（既定）:

```bash
npm run db:migrate:remote
npm run deploy
```

このコマンドでは`wrangler.jsonc`の`FREE_TIER_ONLY=true`が適用されます。

Workers for Platformsを契約し、`appforge-apps` dispatch namespaceを作成済みの場合:

```bash
npm run db:migrate:remote
npm run deploy:platform
```

Workers for Platformsは有料機能なので、契約前は通常構成を使えます。

## Release checklist

- Access policyが期待するユーザー/グループだけを許可している
- SecretsがUI bundleやGitへ含まれていない
- D1 migrationが全件適用済み
- Queue consumerとdead-letter queueが接続済み
- OGP生成失敗時にSVGフォールバックが作られる
- ClaudeとCloudflare APIの利用量アラートを設定済み
- rate limit、tenant quota、データ保持・削除ルールを決定済み
