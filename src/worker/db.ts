import type { AppDetail, AppSummary, ChatMessage } from "../shared/types";
import type { AppRow, MessageRow } from "./types";

const APP_COLUMNS = `
  id, slug, title, prompt, description, status, preview_url, worker_name,
  thumbnail_key, error_message, created_at, updated_at
`;

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    appId: row.app_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
}

export function toSummary(row: AppRow): AppSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    prompt: row.prompt,
    description: row.description,
    status: row.status,
    previewUrl: row.preview_url,
    thumbnailUrl: row.thumbnail_key ? `/api/apps/${row.id}/thumbnail` : null,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listApps(db: D1Database, limit = 24): Promise<AppSummary[]> {
  const result = await db
    .prepare(`SELECT ${APP_COLUMNS} FROM apps ORDER BY created_at DESC LIMIT ?`)
    .bind(limit)
    .all<AppRow>();
  return result.results.map(toSummary);
}

export async function getAppRow(db: D1Database, id: string, withSource = false): Promise<AppRow | null> {
  const columns = withSource ? `${APP_COLUMNS}, source_html` : APP_COLUMNS;
  return db.prepare(`SELECT ${columns} FROM apps WHERE id = ?`).bind(id).first<AppRow>();
}

export async function getAppBySlug(db: D1Database, slug: string): Promise<AppRow | null> {
  return db.prepare(`SELECT ${APP_COLUMNS} FROM apps WHERE slug = ?`).bind(slug).first<AppRow>();
}

export async function getAppDetail(db: D1Database, id: string): Promise<AppDetail | null> {
  const app = await getAppRow(db, id);
  if (!app) return null;

  const messages = await db
    .prepare("SELECT id, app_id, role, content, created_at FROM messages WHERE app_id = ? ORDER BY created_at ASC")
    .bind(id)
    .all<MessageRow>();

  return { ...toSummary(app), messages: messages.results.map(toMessage) };
}

export async function addMessage(
  db: D1Database,
  appId: string,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  await db
    .prepare("INSERT INTO messages (id, app_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), appId, role, content, new Date().toISOString())
    .run();
}

