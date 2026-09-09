# AppForge

チャットで要件を壁打ちし、Claudeが動くWebアプリを生成し、プレビュー・公開・機能追加・ロールバックまで行うCloudflareネイティブのアプリビルダーです。

## 実装済み

- Claude APIによるアプリ生成（APIキー未設定のローカル環境では決定的なフォールバック生成）
- 会話を続けるたびに不変の新バージョンを作成
- バージョン別プレビュー、公開、旧版へのロールバック、ソース成果物のダウンロード
- バージョンごとのコレクション・フィールド・参照関係をER図として可視化
- Cloudflare Access JWT検証による本番認証
- ワークスペース（tenant）、owner / admin / editor / viewer、メール招待
- tenant / app単位に分離された共通データAPI
- 生成アプリ専用のハッシュ化されたランタイムトークン
- D1の会話・バージョン・監査・AI利用量・業務データ保存
- Queuesによる非同期ビルド、R2へのソース成果物とOGP画像保存
- 無料モードのSVG OGP画像（有料モードではBrowser Renderingのスクリーンショットも選択可能）
- 通常のWorkers APIとWorkers for Platforms dispatch namespaceの両方に対応
- OGP付き共有ページとテナント内ギャラリー

勤怠管理、申請管理、簡易CRM、TODO、ダッシュボードなど、構造化された業務データを扱う生成アプリは`window.AppForge.data`を通じてデータを永続化できます。アプリを再生成しても、同じ`appId`のデータは残ります。

## ローカル起動

Node.js 20以降が必要です。

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

- UI: <http://localhost:5173>
- Worker API: <http://localhost:8787>
- 初回起動時にローカルD1マイグレーションを自動適用
- `ANTHROPIC_API_KEY`が空なら外部通信せず、ローカル用テンプレートで生成

Claudeで生成する場合は`.dev.vars`へ次だけ設定します。

```dotenv
ANTHROPIC_API_KEY=your_anthropic_api_key
ANTHROPIC_MODEL=claude-sonnet-5
```

既定の`FREE_TIER_ONLY=true`では、生成アプリごとのWorker upload、Workers for Platforms、Browser Renderingを呼びません。生成物はAppForge Workerの`/preview/...`から配信され、OGPはR2へSVGとして保存されます。

## 主要フロー

```text
React chat UI
  └─ AppForge Worker
      ├─ Cloudflare Access: user authentication
      ├─ D1: tenants / apps / versions / chat / audit / app records
      ├─ Queue: version build jobs
      ├─ Claude API (optionally through AI Gateway): source generation
      ├─ R2: immutable source artifacts + OGP images
      ├─ Free mode: SVG OGP + AppForge内プレビュー/公開
      └─ Optional paid mode: Browser Rendering + per-app Workers
```

MCPはAppForge自体を開発・運用するために利用できますが、エンドユーザーからの各生成リクエストはMCPプロセスを起動せず、WorkerからClaude APIとCloudflare APIを直接呼びます。

詳しい境界とデータモデルは[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)、本番手順は[docs/PRODUCTION.md](docs/PRODUCTION.md)を参照してください。

## コマンド

```bash
npm run dev                 # ローカルD1を更新してUI + Workerを起動
npm run typecheck           # TypeScript
npm test                    # Vitest
npm run build               # UI production build
npm run db:migrate:remote   # 本番D1 migration
npm run deploy              # 無料モードの既定構成
npm run deploy:platform     # 明示的に有料構成へ移行する場合のみ
```

## 生成アプリのランタイムAPI

Claudeへは次のAPIを使うよう指示しています。生成HTMLへ安全なクライアントが自動注入されます。

```js
const rows = await window.AppForge.data.list("shifts");
const row = await window.AppForge.data.create("shifts", { employee: "A", clockIn: "09:00" });
await window.AppForge.data.update("shifts", row.id, { employee: "A", clockOut: "18:00" });
await window.AppForge.data.remove("shifts", row.id);
```

各トークンは1アプリだけに限定され、サーバー側ではtenant / app / collectionを常に条件へ含めます。業務用途ではCloudflare Accessで公開URL自体も保護してください。

## セキュリティ上の境界

- 管理APIはCloudflare Access JWTのissuer / audience / signatureを検証
- mutationは同一originまたはアプリ専用トークンのみ許可
- HTMLは500KB、レコードは64KB、collectionは許可文字、一覧は最大1,000件
- ユーザーHTMLをWorkerコードとして直接評価せず、信頼済み配信ラッパーへ文字列として格納
- APIキーはWorker Secretsに保存し、管理UIへ返さない
- 生成物はCSPとsandbox iframeでプレビュー
- AI利用量と管理操作をD1へ記録
- 通常構成の個別`workers.dev` URLは既定で無効。Access配下のAppForge URLから配信

公開前にはCloudflare Access policy、API Tokenの最小権限、レート制限、利用量上限、バックアップ・削除ポリシーを組織要件に合わせて設定してください。
