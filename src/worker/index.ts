import { Hono } from "hono";
import { AuthError, authenticate, authenticateRuntime, requireAdmin, requireEditor } from "./auth";
import { processBuild, publishVersion } from "./build";
import { addMessage, getAppBySlug, getAppDetail, getAppRow, getVersionRow, listApps, writeAudit } from "./db";
import { injectSocialMetadata } from "./html";
import { titleFromPrompt } from "./templates";
import type { AuthContext, BuildJob, Env, VersionRow } from "./types";

type HonoEnv = { Bindings: Env; Variables: { auth: AuthContext } };
const app = new Hono<HonoEnv>();

function jsonError(message: string, status: 400 | 401 | 403 | 404 | 409 | 500 | 503 = 400): Response {
  return Response.json({ error: message }, { status });
}

async function readPrompt(request: Request): Promise<string> {
  let payload: unknown;
  try { payload = await request.json(); } catch { throw new Error("JSON body is required."); }
  const prompt = typeof payload === "object" && payload !== null && "prompt" in payload ? (payload as { prompt: unknown }).prompt : null;
  if (typeof prompt !== "string") throw new Error("prompt must be a string.");
  const normalized = prompt.trim();
  if (normalized.length < 3) throw new Error("もう少し詳しく、3文字以上で入力してください。");
  if (normalized.length > 8_000) throw new Error("プロンプトは8,000文字以内にしてください。");
  return normalized;
}

async function scheduleBuild(env: Env, job: BuildJob, waitUntil: (promise: Promise<unknown>) => void): Promise<void> {
  if (env.ENVIRONMENT === "development" || !env.BUILDS) {
    waitUntil(processBuild(env, job));
    return;
  }
  await env.BUILDS.send(job);
}

function assertSameOrigin(request: Request, env: Env): void {
  if (env.ENVIRONMENT === "development" || request.method === "GET" || request.method === "HEAD" || request.headers.has("x-appforge-runtime-token")) return;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new AuthError("Cross-origin mutation rejected.", 403);
}

app.use("/api/runtime/*", async (c, next) => {
  c.header("access-control-allow-origin", "*");
  c.header("access-control-allow-headers", "content-type, x-appforge-runtime-token");
  c.header("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (c.req.method === "OPTIONS") return c.body(null, 204);
  return next();
});

app.use("/api/*", async (c, next) => {
  c.header("cache-control", "no-store");
  c.header("x-content-type-options", "nosniff");
  if (c.req.path === "/api/health") return next();
  try {
    assertSameOrigin(c.req.raw, c.env);
    const useRuntimeToken = c.req.path.startsWith("/api/runtime/") && c.req.header("x-appforge-runtime-token")
      && !c.req.header("cf-access-jwt-assertion") && c.env.ENVIRONMENT !== "development";
    c.set("auth", useRuntimeToken ? await authenticateRuntime(c.req.raw, c.env) : await authenticate(c.req.raw, c.env));
    return await next();
  } catch (error) {
    if (error instanceof AuthError) return jsonError(error.message, error.status);
    console.error("Authentication failed.", error);
    return jsonError("Authentication failed.", 401);
  }
});

app.get("/api/health", (c) => c.json({
  ok: true,
  environment: c.env.ENVIRONMENT ?? "production",
  aiProvider: c.env.AI_PROVIDER ?? (c.env.AI ? "workers-ai" : "fallback"),
  aiReady: c.env.AI_PROVIDER === "workers-ai" ? Boolean(c.env.AI) : Boolean(c.env.ANTHROPIC_API_KEY || c.env.AI_GATEWAY_TOKEN),
}));
app.get("/api/session", (c) => c.json({ session: c.get("auth") }));

function workspaceSlug(name: string): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "workspace";
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

app.post("/api/tenants", async (c) => {
  const auth = c.get("auth");
  const body: { name?: unknown } = await c.req.json<{ name?: unknown }>().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (name.length < 2) return jsonError("Workspace name must be at least 2 characters.");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO tenants (id, slug, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, workspaceSlug(name), name, auth.user.id, now),
    c.env.DB.prepare("INSERT INTO memberships (tenant_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)")
      .bind(id, auth.user.id, now),
  ]);
  return c.json({ tenant: { id, name } }, 201);
});

app.get("/api/tenants/current/members", async (c) => {
  const auth = c.get("auth");
  try { requireAdmin(auth); } catch (error) { return jsonError((error as Error).message, 403); }
  const [members, invites] = await Promise.all([
    c.env.DB.prepare(`SELECT u.id, u.email, u.name, u.avatar_url AS avatarUrl, m.role, m.created_at AS joinedAt
      FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ? ORDER BY m.created_at`).bind(auth.tenant.id).all(),
    c.env.DB.prepare(`SELECT id, email, role, status, created_at AS createdAt FROM tenant_invites
      WHERE tenant_id = ? ORDER BY created_at DESC`).bind(auth.tenant.id).all(),
  ]);
  return c.json({ members: members.results, invites: invites.results });
});

app.post("/api/tenants/current/invites", async (c) => {
  const auth = c.get("auth");
  try { requireAdmin(auth); } catch (error) { return jsonError((error as Error).message, 403); }
  const body: { email?: unknown; role?: unknown } = await c.req.json<{ email?: unknown; role?: unknown }>().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const role = body.role;
  if (!/^\S+@\S+\.\S+$/.test(email)) return jsonError("A valid email is required.");
  if (role !== "admin" && role !== "editor" && role !== "viewer") return jsonError("Role must be admin, editor, or viewer.");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(`INSERT INTO tenant_invites (id, tenant_id, email, role, status, invited_by, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?, ?)
    ON CONFLICT(tenant_id, email) DO UPDATE SET role = excluded.role, status = 'pending', invited_by = excluded.invited_by,
      accepted_by = NULL, created_at = excluded.created_at, accepted_at = NULL`)
    .bind(id, auth.tenant.id, email, role, auth.user.id, now).run();
  const saved = await c.env.DB.prepare("SELECT id FROM tenant_invites WHERE tenant_id = ? AND email = ?")
    .bind(auth.tenant.id, email).first<{ id: string }>();
  await writeAudit(c.env.DB, { tenantId: auth.tenant.id, userId: auth.user.id, action: "member.invited", metadata: { email, role } });
  return c.json({ invite: { id: saved?.id ?? id, email, role, status: "pending" } }, 201);
});

app.delete("/api/tenants/current/invites/:inviteId", async (c) => {
  const auth = c.get("auth");
  try { requireAdmin(auth); } catch (error) { return jsonError((error as Error).message, 403); }
  await c.env.DB.prepare("UPDATE tenant_invites SET status = 'revoked' WHERE id = ? AND tenant_id = ?")
    .bind(c.req.param("inviteId"), auth.tenant.id).run();
  return c.body(null, 204);
});

app.get("/api/apps", async (c) => c.json({ apps: await listApps(c.env.DB, c.get("auth").tenant.id) }));

function validCollection(value: string): boolean {
  return /^[a-z][a-z0-9_-]{0,47}$/.test(value);
}

function runtimeCanAccess(auth: AuthContext, appId: string): boolean {
  return !auth.runtimeAppId || auth.runtimeAppId === appId;
}

async function readRecordData(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json() as { data?: unknown };
  if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) throw new Error("data must be a JSON object.");
  if (new TextEncoder().encode(JSON.stringify(body.data)).byteLength > 64_000) throw new Error("Record data exceeds 64 KB.");
  return body.data as Record<string, unknown>;
}

app.get("/api/runtime/apps/:id/data/:collection", async (c) => {
  const auth = c.get("auth");
  const collection = c.req.param("collection");
  if (!runtimeCanAccess(auth, c.req.param("id"))) return jsonError("App runtime token does not match this app.", 403);
  if (!validCollection(collection)) return jsonError("Invalid collection name.");
  if (!await getAppRow(c.env.DB, c.req.param("id"), auth.tenant.id)) return jsonError("App not found.", 404);
  const rows = await c.env.DB.prepare(`SELECT id, data, created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt
    FROM app_records WHERE tenant_id = ? AND app_id = ? AND collection = ? ORDER BY updated_at DESC LIMIT 1000`)
    .bind(auth.tenant.id, c.req.param("id"), collection).all<{ id: string; data: string; createdBy: string; createdAt: string; updatedAt: string }>();
  return c.json({ records: rows.results.map((row) => ({ ...JSON.parse(row.data), id: row.id, createdBy: row.createdBy, createdAt: row.createdAt, updatedAt: row.updatedAt })) });
});

app.get("/api/runtime/apps/:id/session", async (c) => {
  const auth = c.get("auth");
  if (!runtimeCanAccess(auth, c.req.param("id"))) return jsonError("App runtime token does not match this app.", 403);
  if (!await getAppRow(c.env.DB, c.req.param("id"), auth.tenant.id)) return jsonError("App not found.", 404);
  return c.json({ session: { user: auth.user, tenant: auth.tenant } });
});

app.post("/api/runtime/apps/:id/data/:collection", async (c) => {
  const auth = c.get("auth");
  try { requireEditor(auth); } catch (error) { return jsonError((error as Error).message, 403); }
  const collection = c.req.param("collection");
  if (!runtimeCanAccess(auth, c.req.param("id"))) return jsonError("App runtime token does not match this app.", 403);
  if (!validCollection(collection)) return jsonError("Invalid collection name.");
  if (!await getAppRow(c.env.DB, c.req.param("id"), auth.tenant.id)) return jsonError("App not found.", 404);
  let data: Record<string, unknown>;
  try { data = await readRecordData(c.req.raw); } catch (error) { return jsonError((error as Error).message); }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.prepare(`INSERT INTO app_records (tenant_id, app_id, collection, id, data, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(auth.tenant.id, c.req.param("id"), collection, id, JSON.stringify(data), auth.user.id, now, now).run();
  return c.json({ record: { ...data, id, createdBy: auth.user.id, createdAt: now, updatedAt: now } }, 201);
});

app.put("/api/runtime/apps/:id/data/:collection/:recordId", async (c) => {
  const auth = c.get("auth");
  try { requireEditor(auth); } catch (error) { return jsonError((error as Error).message, 403); }
  const collection = c.req.param("collection");
  if (!runtimeCanAccess(auth, c.req.param("id"))) return jsonError("App runtime token does not match this app.", 403);
  if (!validCollection(collection)) return jsonError("Invalid collection name.");
  let data: Record<string, unknown>;
  try { data = await readRecordData(c.req.raw); } catch (error) { return jsonError((error as Error).message); }
  const now = new Date().toISOString();
  const result = await c.env.DB.prepare(`UPDATE app_records SET data = ?, updated_at = ?
    WHERE tenant_id = ? AND app_id = ? AND collection = ? AND id = ?`)
    .bind(JSON.stringify(data), now, auth.tenant.id, c.req.param("id"), collection, c.req.param("recordId")).run();
  if (!result.meta.changes) return jsonError("Record not found.", 404);
  return c.json({ record: { ...data, id: c.req.param("recordId"), updatedAt: now } });
});

app.delete("/api/runtime/apps/:id/data/:collection/:recordId", async (c) => {
  const auth = c.get("auth");
  try { requireEditor(auth); } catch (error) { return jsonError((error as Error).message, 403); }
  const collection = c.req.param("collection");
  if (!runtimeCanAccess(auth, c.req.param("id"))) return jsonError("App runtime token does not match this app.", 403);
  if (!validCollection(collection)) return jsonError("Invalid collection name.");
  const result = await c.env.DB.prepare(`DELETE FROM app_records WHERE tenant_id = ? AND app_id = ? AND collection = ? AND id = ?`)
    .bind(auth.tenant.id, c.req.param("id"), collection, c.req.param("recordId")).run();
  return result.meta.changes ? c.body(null, 204) : jsonError("Record not found.", 404);
});

app.get("/api/apps/:id", async (c) => {
  const auth = c.get("auth");
  const detail = await getAppDetail(c.env.DB, c.req.param("id"), auth.tenant.id);
  return detail ? c.json({ app: detail }) : jsonError("App not found.", 404);
});

app.post("/api/apps", async (c) => {
  const auth = c.get("auth");
  try { requireEditor(auth); } catch (error) { return jsonError((error as Error).message, 403); }
  let prompt: string;
  try { prompt = await readPrompt(c.req.raw); } catch (error) { return jsonError((error as Error).message); }

  const id = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const title = titleFromPrompt(prompt);
  const slug = `app-${id.replaceAll("-", "").slice(0, 12)}`;
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO apps (id, tenant_id, created_by, slug, title, prompt, description, status, latest_version_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`)
      .bind(id, auth.tenant.id, auth.user.id, slug, title, prompt, "Your idea is waiting to be built.", versionId, now, now),
    c.env.DB.prepare(`INSERT INTO app_versions (id, app_id, version_number, status, title, description, summary, prompt, created_by, created_at, updated_at)
      VALUES (?, ?, 1, 'queued', ?, ?, '', ?, ?, ?, ?)`)
      .bind(versionId, id, title, "Your first version is queued.", prompt, auth.user.id, now, now),
    c.env.DB.prepare("INSERT INTO messages (id, app_id, role, content, user_id, version_id, created_at) VALUES (?, ?, 'user', ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), id, prompt, auth.user.id, versionId, now),
  ]);
  await writeAudit(c.env.DB, { tenantId: auth.tenant.id, userId: auth.user.id, appId: id, action: "app.created", metadata: { versionId } });
  await scheduleBuild(c.env, { appId: id, versionId, tenantId: auth.tenant.id, origin: new URL(c.req.url).origin }, (promise) => c.executionCtx.waitUntil(promise));
  return c.json({ app: await getAppDetail(c.env.DB, id, auth.tenant.id) }, 202);
});

app.post("/api/apps/:id/messages", async (c) => {
  const auth = c.get("auth");
  try { requireEditor(auth); } catch (error) { return jsonError((error as Error).message, 403); }
  const id = c.req.param("id");
  const existing = await getAppRow(c.env.DB, id, auth.tenant.id);
  if (!existing) return jsonError("App not found.", 404);
  if (existing.status === "queued" || existing.status === "building") return jsonError("このアプリは現在ビルド中です。", 409);
  let prompt: string;
  try { prompt = await readPrompt(c.req.raw); } catch (error) { return jsonError((error as Error).message); }

  const next = await c.env.DB.prepare("SELECT COALESCE(MAX(version_number), 0) + 1 AS value FROM app_versions WHERE app_id = ?").bind(id).first<{ value: number }>();
  const versionNumber = next?.value ?? 1;
  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE apps SET prompt = ?, status = 'queued', latest_version_id = ?, error_message = NULL, updated_at = ? WHERE id = ? AND tenant_id = ?")
      .bind(prompt, versionId, now, id, auth.tenant.id),
    c.env.DB.prepare(`INSERT INTO app_versions (id, app_id, version_number, status, title, description, summary, prompt, created_by, based_on_version_id, created_at, updated_at)
      VALUES (?, ?, ?, 'queued', ?, ?, '', ?, ?, ?, ?, ?)`)
      .bind(versionId, id, versionNumber, existing.title, existing.description, prompt, auth.user.id, existing.latest_version_id, now, now),
  ]);
  await addMessage(c.env.DB, id, "user", prompt, auth.user.id, versionId);
  await writeAudit(c.env.DB, { tenantId: auth.tenant.id, userId: auth.user.id, appId: id, action: "version.created", metadata: { versionId, versionNumber, basedOn: existing.latest_version_id } });
  await scheduleBuild(c.env, { appId: id, versionId, tenantId: auth.tenant.id, origin: new URL(c.req.url).origin }, (promise) => c.executionCtx.waitUntil(promise));
  return c.json({ app: await getAppDetail(c.env.DB, id, auth.tenant.id) }, 202);
});

app.post("/api/apps/:id/versions/:versionId/publish", async (c) => {
  const auth = c.get("auth");
  try { requireEditor(auth); } catch (error) { return jsonError((error as Error).message, 403); }
  try {
    await publishVersion(c.env, { tenantId: auth.tenant.id, userId: auth.user.id, appId: c.req.param("id"), versionId: c.req.param("versionId"), origin: new URL(c.req.url).origin });
    return c.json({ app: await getAppDetail(c.env.DB, c.req.param("id"), auth.tenant.id) });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Publish failed.", 409);
  }
});

app.get("/api/apps/:id/versions/:versionId/source", async (c) => {
  const auth = c.get("auth");
  const version = await getVersionRow(c.env.DB, c.req.param("id"), c.req.param("versionId"), auth.tenant.id, true);
  if (!version) return jsonError("Version not found.", 404);
  if (version.source_key && c.env.THUMBNAILS) {
    const object = await c.env.THUMBNAILS.get(version.source_key);
    if (object) return new Response(object.body, { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="appforge-v${version.version_number}.json"` } });
  }
  return c.json({ schemaVersion: 1, entrypoint: "index.html", files: [{ path: "index.html", content: version.source_html ?? "" }] });
});

async function thumbnailResponse(env: Env, key: string | null): Promise<Response> {
  if (!key || !env.THUMBNAILS) return jsonError("Thumbnail not found.", 404);
  const object = await env.THUMBNAILS.get(key);
  if (!object) return jsonError("Thumbnail not found.", 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
}

app.get("/api/apps/:id/thumbnail", async (c) => {
  const auth = c.get("auth");
  return thumbnailResponse(c.env, (await getAppRow(c.env.DB, c.req.param("id"), auth.tenant.id))?.thumbnail_key ?? null);
});

app.get("/api/apps/:id/versions/:versionId/thumbnail", async (c) => {
  const auth = c.get("auth");
  return thumbnailResponse(c.env, (await getVersionRow(c.env.DB, c.req.param("id"), c.req.param("versionId"), auth.tenant.id))?.thumbnail_key ?? null);
});

app.get("/og/:appId/:versionId", async (c) => {
  const row = await c.env.DB.prepare("SELECT thumbnail_key FROM app_versions WHERE id = ? AND app_id = ?").bind(c.req.param("versionId"), c.req.param("appId")).first<{ thumbnail_key: string | null }>();
  return thumbnailResponse(c.env, row?.thumbnail_key ?? null);
});

app.get("/preview/:appId/versions/:versionId", async (c) => {
  const version = await c.env.DB.prepare("SELECT source_html FROM app_versions WHERE id = ? AND app_id = ?").bind(c.req.param("versionId"), c.req.param("appId")).first<{ source_html: string | null }>();
  if (!version?.source_html) return new Response("Preview is not ready.", { status: 404 });
  return new Response(version.source_html, { headers: {
    "content-type": "text/html; charset=utf-8",
    "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; connect-src 'self'; frame-ancestors *",
    "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
  } });
});

app.get("/preview/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT source_html FROM apps WHERE id = ?").bind(c.req.param("id")).first<{ source_html: string | null }>();
  return row?.source_html ? new Response(row.source_html, { headers: { "content-type": "text/html; charset=utf-8" } }) : c.notFound();
});

app.all("/run/:worker/*", async (c) => {
  const worker = c.req.param("worker");
  if (!/^af-[a-z0-9-]{1,58}$/.test(worker) || !c.env.DISPATCHER) return c.notFound();
  try { return await c.env.DISPATCHER.get(worker).fetch(c.req.raw); } catch (error) { console.error("Dispatch failed.", error); return c.notFound(); }
});

app.get("/apps/:slug", async (c) => {
  const row = await getAppBySlug(c.env.DB, c.req.param("slug"));
  if (!row || !c.env.ASSETS) return c.notFound();
  const index = await c.env.ASSETS.fetch(new URL("/", c.req.url));
  if (!index.ok) return index;
  const pageUrl = new URL(c.req.url).toString();
  const versionId = row.published_version_id ?? row.latest_version_id;
  const imageUrl = versionId ? `${new URL(c.req.url).origin}/og/${row.id}/${versionId}` : undefined;
  return new Response(injectSocialMetadata(await index.text(), { title: row.title, description: row.description, url: pageUrl, imageUrl }), { headers: { "content-type": "text/html; charset=utf-8" } });
});

app.all("*", async (c) => c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.notFound());

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<BuildJob>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try { await processBuild(env, message.body); message.ack(); }
      catch (error) { console.error("Build job failed.", error); message.retry({ delaySeconds: 15 }); }
    }
  },
} satisfies ExportedHandler<Env, BuildJob>;
