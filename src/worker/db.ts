import type { AppDetail, AppSummary, AppVersionSummary, ChatMessage } from "../shared/types";
import type { AppRow, MessageRow, VersionRow } from "./types";

const APP_COLUMNS = `
  id, tenant_id, created_by, slug, title, prompt, description, status, preview_url, worker_name,
  thumbnail_key, error_message, latest_version_id, published_version_id, app_database_id, created_at, updated_at
`;

const VERSION_COLUMNS = `
  id, app_id, version_number, status, title, description, summary, prompt, source_key, source_html,
  source_hash, preview_url, worker_name, thumbnail_key, error_message, created_by, based_on_version_id,
  created_at, updated_at, published_at
`;

function toMessage(row: MessageRow): ChatMessage {
  return { id: row.id, appId: row.app_id, role: row.role, content: row.content, createdAt: row.created_at };
}

export function toVersion(row: VersionRow): AppVersionSummary {
  return {
    id: row.id,
    appId: row.app_id,
    versionNumber: row.version_number,
    status: row.status,
    title: row.title,
    description: row.description,
    summary: row.summary,
    prompt: row.prompt,
    sourceKey: row.source_key,
    previewUrl: row.status === "ready" || row.status === "published"
      ? `/preview/${row.app_id}/versions/${row.id}`
      : row.preview_url,
    thumbnailUrl: row.thumbnail_key ? `/api/apps/${row.app_id}/versions/${row.id}/thumbnail` : null,
    errorMessage: row.error_message,
    basedOnVersionId: row.based_on_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
}

export function toSummary(row: AppRow, latestVersionNumber: number | null = null, publishedVersionNumber: number | null = null): AppSummary {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    slug: row.slug,
    title: row.title,
    prompt: row.prompt,
    description: row.description,
    status: row.status,
    previewUrl: row.preview_url,
    thumbnailUrl: row.thumbnail_key ? `/api/apps/${row.id}/thumbnail` : null,
    errorMessage: row.error_message,
    latestVersionId: row.latest_version_id,
    publishedVersionId: row.published_version_id,
    latestVersionNumber,
    publishedVersionNumber,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listApps(db: D1Database, tenantId: string, limit = 24): Promise<AppSummary[]> {
  const result = await db.prepare(`SELECT ${APP_COLUMNS},
      (SELECT version_number FROM app_versions WHERE id = apps.latest_version_id) AS latest_number,
      (SELECT version_number FROM app_versions WHERE id = apps.published_version_id) AS published_number
    FROM apps WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?`)
    .bind(tenantId, limit).all<AppRow & { latest_number: number | null; published_number: number | null }>();
  return result.results.map((row) => toSummary(row, row.latest_number, row.published_number));
}

export async function getAppRow(db: D1Database, id: string, tenantId: string, withSource = false): Promise<AppRow | null> {
  const columns = withSource ? `${APP_COLUMNS}, source_html` : APP_COLUMNS;
  return db.prepare(`SELECT ${columns} FROM apps WHERE id = ? AND tenant_id = ?`).bind(id, tenantId).first<AppRow>();
}

export async function getAppBySlug(db: D1Database, slug: string, tenantId?: string): Promise<AppRow | null> {
  const scope = tenantId ? "slug = ? AND tenant_id = ?" : "slug = ?";
  const values = tenantId ? [slug, tenantId] : [slug];
  return db.prepare(`SELECT ${APP_COLUMNS} FROM apps WHERE ${scope}`).bind(...values).first<AppRow>();
}

export async function getVersionRow(db: D1Database, appId: string, versionId: string, tenantId: string, withSource = false): Promise<VersionRow | null> {
  const columns = withSource ? VERSION_COLUMNS : VERSION_COLUMNS.replace(", source_html", "");
  return db.prepare(`SELECT ${columns} FROM app_versions WHERE id = ? AND app_id IN (SELECT id FROM apps WHERE id = ? AND tenant_id = ?)`)
    .bind(versionId, appId, tenantId).first<VersionRow>();
}

export async function getLatestVersionRow(db: D1Database, app: AppRow, withSource = false): Promise<VersionRow | null> {
  if (!app.latest_version_id) return null;
  const columns = withSource ? VERSION_COLUMNS : VERSION_COLUMNS.replace(", source_html", "");
  return db.prepare(`SELECT ${columns} FROM app_versions WHERE id = ? AND app_id = ?`).bind(app.latest_version_id, app.id).first<VersionRow>();
}

export async function getAppDetail(db: D1Database, id: string, tenantId: string): Promise<AppDetail | null> {
  const app = await getAppRow(db, id, tenantId);
  if (!app) return null;
  const [messages, versions] = await Promise.all([
    db.prepare("SELECT id, app_id, role, content, user_id, version_id, created_at FROM messages WHERE app_id = ? ORDER BY created_at ASC").bind(id).all<MessageRow>(),
    db.prepare(`SELECT ${VERSION_COLUMNS.replace(", source_html", "")} FROM app_versions WHERE app_id = ? ORDER BY version_number DESC`).bind(id).all<VersionRow>(),
  ]);
  const versionItems = versions.results.map(toVersion);
  const latestNumber = versionItems.find((item) => item.id === app.latest_version_id)?.versionNumber ?? null;
  const publishedNumber = versionItems.find((item) => item.id === app.published_version_id)?.versionNumber ?? null;
  return { ...toSummary(app, latestNumber, publishedNumber), messages: messages.results.map(toMessage), versions: versionItems };
}

export async function addMessage(db: D1Database, appId: string, role: "user" | "assistant", content: string, userId?: string | null, versionId?: string | null): Promise<void> {
  await db.prepare("INSERT INTO messages (id, app_id, role, content, user_id, version_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), appId, role, content, userId ?? null, versionId ?? null, new Date().toISOString()).run();
}

export async function writeAudit(db: D1Database, data: { tenantId: string; userId?: string | null; appId?: string | null; action: string; metadata?: unknown }): Promise<void> {
  await db.prepare("INSERT INTO audit_events (id, tenant_id, user_id, app_id, action, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), data.tenantId, data.userId ?? null, data.appId ?? null, data.action, JSON.stringify(data.metadata ?? {}), new Date().toISOString()).run();
}
