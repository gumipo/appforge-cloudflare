import { loadArtifact, makeArtifact, hashSource, saveArtifact } from "./artifacts";
import { addMessage, getAppRow, getVersionRow, writeAudit } from "./db";
import { deployVersionedHtml } from "./deployer";
import { generateApp } from "./generator";
import { prepareGeneratedHtml } from "./html";
import { createThumbnail } from "./thumbnail";
import type { BuildJob, Env } from "./types";
import { hashRuntimeToken } from "./auth";

function previewWorkerName(appId: string, versionNumber: number): string {
  return `af-${appId.replaceAll("-", "").slice(0, 16)}-v${versionNumber}`;
}

function productionWorkerName(appId: string): string {
  return `af-${appId.replaceAll("-", "").slice(0, 20)}`;
}

function createRuntimeToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function processBuild(env: Env, job: BuildJob): Promise<void> {
  const app = await getAppRow(env.DB, job.appId, job.tenantId);
  const version = app ? await getVersionRow(env.DB, app.id, job.versionId, job.tenantId, true) : null;
  if (!app || !version) throw new Error(`Build target ${job.versionId} no longer exists.`);

  const startedAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE apps SET status = 'building', error_message = NULL, updated_at = ? WHERE id = ? AND tenant_id = ?").bind(startedAt, app.id, job.tenantId),
    env.DB.prepare("UPDATE app_versions SET status = 'building', error_message = NULL, updated_at = ? WHERE id = ?").bind(startedAt, version.id),
    env.DB.prepare("INSERT INTO builds (id, app_id, status, started_at, version_id) VALUES (?, ?, 'building', ?, ?)").bind(crypto.randomUUID(), app.id, startedAt, version.id),
  ]);

  try {
    const baseVersion = version.based_on_version_id
      ? await getVersionRow(env.DB, app.id, version.based_on_version_id, job.tenantId, true)
      : null;
    const previousArtifact = await loadArtifact(env, baseVersion);
    const generated = await generateApp(env, version.prompt, previousArtifact, {
      tenantId: job.tenantId,
      appId: app.id,
      versionId: version.id,
    });
    const runtimeToken = createRuntimeToken();
    const tokenHash = await hashRuntimeToken(runtimeToken);
    const artifactHtml = prepareGeneratedHtml(generated.html, generated.title, generated.description);
    const html = prepareGeneratedHtml(generated.html, generated.title, generated.description, {
      appId: app.id,
      versionId: version.id,
      origin: job.origin,
      token: runtimeToken,
    });
    const artifact = makeArtifact(generated, artifactHtml);
    const artifactJson = JSON.stringify(artifact);
    const [sourceKey, sourceHash] = await Promise.all([
      saveArtifact(env, job.tenantId, app.id, version.version_number, artifact),
      hashSource(artifactJson),
    ]);
    const workerName = previewWorkerName(app.id, version.version_number);
    const target = await deployVersionedHtml(env, workerName, html, [
      `tenant:${job.tenantId}`,
      `app:${app.id}`,
      `version:${version.version_number}`,
      "environment:preview",
    ]);
    const previewUrl = target?.directUrl ?? (target?.platform === "workers-for-platforms"
      ? `${job.origin}/run/${workerName}/`
      : `${job.origin}/preview/${app.id}/versions/${version.id}`);
    const thumbnailKey = await createThumbnail(env, app.id, version.id, previewUrl, generated.title, generated.description);
    const completedAt = new Date().toISOString();

    await env.DB.batch([
      env.DB.prepare(`UPDATE app_versions SET status = 'ready', title = ?, description = ?, summary = ?, data_model = ?, source_key = ?, source_html = ?,
        source_hash = ?, preview_url = ?, worker_name = ?, thumbnail_key = ?, error_message = NULL, updated_at = ? WHERE id = ?`)
        .bind(generated.title, generated.description, generated.summary, JSON.stringify(generated.dataModel), sourceKey, html, sourceHash, previewUrl, target?.workerName ?? null, thumbnailKey, completedAt, version.id),
      env.DB.prepare(`UPDATE apps SET title = ?, description = ?, status = 'ready', preview_url = ?, thumbnail_key = ?, source_html = ?,
        latest_version_id = ?, error_message = NULL, updated_at = ? WHERE id = ? AND tenant_id = ?`)
        .bind(generated.title, generated.description, previewUrl, thumbnailKey, html, version.id, completedAt, app.id, job.tenantId),
      env.DB.prepare("UPDATE builds SET status = 'ready', completed_at = ? WHERE version_id = ? AND status = 'building'").bind(completedAt, version.id),
      env.DB.prepare(`INSERT INTO deployments (id, app_id, version_id, environment, status, worker_name, url, created_by, created_at, completed_at)
        VALUES (?, ?, ?, 'preview', 'ready', ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), app.id, version.id, target?.workerName ?? null, previewUrl, version.created_by, startedAt, completedAt),
      env.DB.prepare(`INSERT INTO runtime_tokens (version_id, app_id, tenant_id, token_hash, created_at, revoked_at)
        VALUES (?, ?, ?, ?, ?, NULL)
        ON CONFLICT(version_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at, revoked_at = NULL`)
        .bind(version.id, app.id, job.tenantId, tokenHash, completedAt),
    ]);
    await addMessage(env.DB, app.id, "assistant", `v${version.version_number}のプレビューができました。確認して問題なければ公開できます。`, null, version.id);
    await writeAudit(env.DB, { tenantId: job.tenantId, userId: version.created_by, appId: app.id, action: "version.ready", metadata: { versionId: version.id, versionNumber: version.version_number, sourceHash } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown build failure";
    const failedAt = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE app_versions SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?").bind(message, failedAt, version.id),
      env.DB.prepare("UPDATE apps SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").bind(message, failedAt, app.id, job.tenantId),
      env.DB.prepare("UPDATE builds SET status = 'failed', error_message = ?, completed_at = ? WHERE version_id = ? AND status = 'building'").bind(message, failedAt, version.id),
    ]);
    await addMessage(env.DB, app.id, "assistant", `v${version.version_number}のビルドに失敗しました: ${message}`, null, version.id);
    throw error;
  }
}

export async function publishVersion(env: Env, data: { tenantId: string; userId: string; appId: string; versionId: string; origin: string }): Promise<void> {
  const app = await getAppRow(env.DB, data.appId, data.tenantId);
  const version = app ? await getVersionRow(env.DB, app.id, data.versionId, data.tenantId, true) : null;
  if (!app || !version) throw new Error("Version not found.");
  if (!version.source_html || (version.status !== "ready" && version.status !== "published")) throw new Error("Only a ready version can be published.");
  const startedAt = new Date().toISOString();
  const workerName = productionWorkerName(app.id);
  const target = await deployVersionedHtml(env, workerName, version.source_html, [
    `tenant:${data.tenantId}`,
    `app:${app.id}`,
    `version:${version.version_number}`,
    "environment:production",
  ]);
  const url = target?.directUrl ?? (target?.platform === "workers-for-platforms"
    ? `${data.origin}/run/${workerName}/`
    : `${data.origin}/preview/${app.id}/versions/${version.id}`);
  const completedAt = new Date().toISOString();
  const statements = [
    env.DB.prepare("UPDATE app_versions SET status = 'ready' WHERE app_id = ? AND status = 'published' AND id != ?").bind(app.id, version.id),
    env.DB.prepare("UPDATE app_versions SET status = 'published', published_at = ?, updated_at = ? WHERE id = ?").bind(completedAt, completedAt, version.id),
    env.DB.prepare(`UPDATE apps SET published_version_id = ?, status = 'ready', preview_url = ?, worker_name = ?, thumbnail_key = ?,
      title = ?, description = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`)
      .bind(version.id, url, target?.workerName ?? null, version.thumbnail_key, version.title, version.description, completedAt, app.id, data.tenantId),
    env.DB.prepare(`INSERT INTO deployments (id, app_id, version_id, environment, status, worker_name, url, created_by, created_at, completed_at)
      VALUES (?, ?, ?, 'production', 'ready', ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), app.id, version.id, target?.workerName ?? null, url, data.userId, startedAt, completedAt),
  ];
  await env.DB.batch(statements);
  await addMessage(env.DB, app.id, "assistant", `v${version.version_number}を本番へ公開しました。`, null, version.id);
  await writeAudit(env.DB, { tenantId: data.tenantId, userId: data.userId, appId: app.id, action: "version.published", metadata: { versionId: version.id, versionNumber: version.version_number, rollback: version.id !== app.latest_version_id } });
}
