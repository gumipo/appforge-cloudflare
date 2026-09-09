# Architecture

## Control planeとgenerated app

AppForge Workerはcontrol planeです。ユーザー、workspace、会話、バージョン、公開先、監査ログを管理します。Claudeが返す成果物は`app_versions`へ不変の版として登録し、完全なJSON artifactをR2へ保存します。

生成アプリはdata planeです。通常構成では個別Worker、Workers for Platforms構成ではdispatch namespaceのuser Workerとして動きます。各バージョンはAppForge runtime clientを内包し、tenant / appに限定されたAPIで業務データを読み書きします。

## Build lifecycle

1. `POST /api/apps`または既存アプリのmessage APIがqueued versionを作る。
2. Queue consumerが直前のartifactと新しい指示をClaudeへ渡す。
3. 応答を検証し、CSP・OGP・runtime clientを注入する。
4. source hashとartifactをR2へ保存する。
5. preview Workerへアップロードし、Browser RenderingでOGPを撮影する。
6. ユーザーが明示的にpublishした版だけproduction Workerへ反映する。
7. 旧版をpublishすれば同じproduction Workerへ再デプロイされ、ロールバックになる。

## Tenant isolation

- `users`: Cloudflare Access subjectとメール
- `tenants`: workspace
- `memberships`: role付き所属
- `tenant_invites`: ログイン時にメール一致で自動承認
- `apps`: 必ず`tenant_id`を保持
- `app_records`: `(tenant_id, app_id, collection, id)`で分離
- `runtime_tokens`: SHA-256 hashのみ保存し、1つの`app_id`に限定

owner/adminは招待、owner/admin/editorは生成・編集・データ更新、viewerは参照のみです。control planeの全app queryは認証済みtenant IDを条件に含めます。

## Version model

`apps.latest_version_id`は最後に生成した版、`apps.published_version_id`は本番版です。この2つを分けることで、プレビュー中の変更が本番へ勝手に反映されません。`app_versions.based_on_version_id`で派生元を追跡し、R2 artifactと`source_hash`で生成結果を固定します。

## Current scope

生成成果物は自己完結HTML/CSS/JavaScriptを中心にしています。共通JSON record runtimeにより通常の業務CRUDは作れます。任意npm依存、任意サーバーコード、アプリごとの専用D1 migration、外部OAuth連携を生成させるには、次段階として隔離ビルド環境・依存許可リスト・secret broker・resource provisionerを追加してください。
