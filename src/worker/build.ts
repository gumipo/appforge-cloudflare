import { addMessage, getAppRow } from "./db";
import { deployGeneratedHtml } from "./deployer";
import { generateApp } from "./generator";
import { prepareGeneratedHtml } from "./html";
import { createThumbnail } from "./thumbnail";
import type { BuildJob, Env } from "./types";

export async function processBuild(env: Env, job: BuildJob): Promise<void> {
  const app = await getAppRow(env.DB, job.appId, true);
  if (!app) throw new Error(`App ${job.appId} no longer exists.`);

  const startedAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE apps SET status = 'building', error_message = NULL, updated_at = ? WHERE id = ?").bind(startedAt, app.id),
    env.DB.prepare("INSERT INTO builds (id, app_id, status, started_at) VALUES (?, ?, 'building', ?)").bind(crypto.randomUUID(), app.id, startedAt),
  ]);

  try {
    const generated = await generateApp(env, app.prompt, app.source_html);
    const html = prepareGeneratedHtml(generated.html, generated.title, generated.description);
    const workerName = `appforge-${app.id.replaceAll("-", "").slice(0, 16)}`;
    const deployedUrl = await deployGeneratedHtml(env, workerName, html);
    const previewUrl = deployedUrl ?? `${job.origin}/preview/${app.id}`;
    const thumbnailKey = await createThumbnail(env, app.id, previewUrl, generated.title, generated.description);
    const completedAt = new Date().toISOString();

    await env.DB.batch([
      env.DB
        .prepare(`UPDATE apps SET title = ?, description = ?, status = 'ready', preview_url = ?, worker_name = ?, thumbnail_key = ?, source_html = ?, error_message = NULL, updated_at = ? WHERE id = ?`)
        .bind(generated.title, generated.description, previewUrl, deployedUrl ? workerName : null, thumbnailKey, html, completedAt, app.id),
      env.DB
        .prepare("UPDATE builds SET status = 'ready', completed_at = ? WHERE app_id = ? AND status = 'building'")
        .bind(completedAt, app.id),
    ]);
    await addMessage(env.DB, app.id, "assistant", deployedUrl
      ? "できました。Cloudflare Workersへ公開し、OGP画像も生成しました。"
      : "できました。ローカルプレビューとOGP用サムネイルを生成しました。");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown build failure";
    const failedAt = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE apps SET status = 'failed', error_message = ?, updated_at = ? WHERE id = ?").bind(message, failedAt, app.id),
      env.DB.prepare("UPDATE builds SET status = 'failed', error_message = ?, completed_at = ? WHERE app_id = ? AND status = 'building'").bind(message, failedAt, app.id),
    ]);
    await addMessage(env.DB, app.id, "assistant", `ビルドに失敗しました: ${message}`);
    throw error;
  }
}

