import { Hono } from "hono";
import { getAppBySlug, getAppDetail, getAppRow, listApps, addMessage } from "./db";
import { processBuild } from "./build";
import { injectSocialMetadata } from "./html";
import { titleFromPrompt } from "./templates";
import type { BuildJob, Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

function jsonError(message: string, status: 400 | 404 | 500 = 400): Response {
  return Response.json({ error: message }, { status });
}

async function readPrompt(request: Request): Promise<string> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    throw new Error("JSON body is required.");
  }
  const prompt = typeof payload === "object" && payload !== null && "prompt" in payload
    ? (payload as { prompt: unknown }).prompt
    : null;
  if (typeof prompt !== "string") throw new Error("prompt must be a string.");
  const normalized = prompt.trim();
  if (normalized.length < 3) throw new Error("もう少し詳しく、3文字以上で入力してください。");
  if (normalized.length > 2_000) throw new Error("プロンプトは2,000文字以内にしてください。");
  return normalized;
}

async function scheduleBuild(env: Env, job: BuildJob, waitUntil: (promise: Promise<unknown>) => void): Promise<void> {
  if (env.ENVIRONMENT === "development" || !env.BUILDS) {
    waitUntil(processBuild(env, job));
    return;
  }
  await env.BUILDS.send(job);
}

app.use("/api/*", async (c, next) => {
  await next();
  c.header("cache-control", "no-store");
  c.header("x-content-type-options", "nosniff");
});

app.get("/api/health", (c) => c.json({ ok: true, environment: c.env.ENVIRONMENT ?? "production" }));

app.get("/api/apps", async (c) => c.json({ apps: await listApps(c.env.DB) }));

app.get("/api/apps/:id", async (c) => {
  const detail = await getAppDetail(c.env.DB, c.req.param("id"));
  return detail ? c.json({ app: detail }) : jsonError("App not found.", 404);
});

app.post("/api/apps", async (c) => {
  let prompt: string;
  try {
    prompt = await readPrompt(c.req.raw);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid request.");
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const title = titleFromPrompt(prompt);
  const slug = `app-${id.replaceAll("-", "").slice(0, 12)}`;
  await c.env.DB.batch([
    c.env.DB
      .prepare(`INSERT INTO apps (id, slug, title, prompt, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)`)
      .bind(id, slug, title, prompt, "Your idea is waiting to be built.", now, now),
    c.env.DB
      .prepare("INSERT INTO messages (id, app_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)")
      .bind(crypto.randomUUID(), id, prompt, now),
  ]);

  await scheduleBuild(c.env, { appId: id, origin: new URL(c.req.url).origin }, (promise) => c.executionCtx.waitUntil(promise));
  const detail = await getAppDetail(c.env.DB, id);
  return c.json({ app: detail }, 202);
});

app.post("/api/apps/:id/messages", async (c) => {
  const id = c.req.param("id");
  const existing = await getAppRow(c.env.DB, id);
  if (!existing) return jsonError("App not found.", 404);
  if (existing.status === "queued" || existing.status === "building") return jsonError("このアプリは現在ビルド中です。");

  let prompt: string;
  try {
    prompt = await readPrompt(c.req.raw);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid request.");
  }

  const now = new Date().toISOString();
  await c.env.DB
    .prepare("UPDATE apps SET prompt = ?, status = 'queued', error_message = NULL, updated_at = ? WHERE id = ?")
    .bind(prompt, now, id)
    .run();
  await addMessage(c.env.DB, id, "user", prompt);
  await scheduleBuild(c.env, { appId: id, origin: new URL(c.req.url).origin }, (promise) => c.executionCtx.waitUntil(promise));
  return c.json({ app: await getAppDetail(c.env.DB, id) }, 202);
});

app.get("/api/apps/:id/thumbnail", async (c) => {
  const row = await getAppRow(c.env.DB, c.req.param("id"));
  if (!row?.thumbnail_key || !c.env.THUMBNAILS) return jsonError("Thumbnail not found.", 404);
  const object = await c.env.THUMBNAILS.get(row.thumbnail_key);
  if (!object) return jsonError("Thumbnail not found.", 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
});

app.get("/preview/:id", async (c) => {
  const row = await getAppRow(c.env.DB, c.req.param("id"), true);
  if (!row?.source_html) return new Response("Preview is not ready.", { status: 404 });
  return new Response(row.source_html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; connect-src 'none'; frame-ancestors *",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
});

app.get("/apps/:slug", async (c) => {
  const row = await getAppBySlug(c.env.DB, c.req.param("slug"));
  if (!row || !c.env.ASSETS) return c.notFound();
  const index = await c.env.ASSETS.fetch(new URL("/", c.req.url));
  if (!index.ok) return index;
  const pageUrl = new URL(c.req.url).toString();
  const imageUrl = row.thumbnail_key ? `${new URL(c.req.url).origin}/api/apps/${row.id}/thumbnail` : undefined;
  return new Response(injectSocialMetadata(await index.text(), {
    title: row.title,
    description: row.description,
    url: pageUrl,
    imageUrl,
  }), { headers: { "content-type": "text/html; charset=utf-8" } });
});

app.all("*", async (c) => c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.notFound());

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<BuildJob>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processBuild(env, message.body);
        message.ack();
      } catch (error) {
        console.error("Build job failed.", error);
        message.retry({ delaySeconds: 15 });
      }
    }
  },
} satisfies ExportedHandler<Env, BuildJob>;

