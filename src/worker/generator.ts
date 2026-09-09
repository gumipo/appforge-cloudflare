import { stripCodeFence } from "./html";
import { createFallbackApp } from "./templates";
import type { AppArtifact, Env, GeneratedApp } from "./types";

const SYSTEM_PROMPT = `You are the code generation engine for AppForge, a production app builder.
Return strict JSON only with these fields:
{
  "title": string,
  "description": string,
  "summary": string,
  "html": string,
  "files": [{"path": string, "content": string}],
  "dataModel": [{"name": string, "fields": [{"name": string, "type": "text"|"number"|"boolean"|"date"|"datetime"|"reference", "required": boolean, "references"?: {"collection": string, "field": string}}]}]
}
The html must be a complete self-contained HTML document with inline CSS and JavaScript and must also be present as files[index.html].
Do not use external assets, arbitrary network requests, CDNs, iframes, eval, or dynamic script creation.
For persistent application data, use the preinstalled runtime only: window.AppForge.data.list(collection), create(collection, data), update(collection, id, data), and remove(collection, id). These return promises and are authenticated, tenant-scoped APIs. Never use localStorage for domain data. Use stable lowercase collection names matching the dataModel names. Show useful loading, empty, and error states.
Describe every persisted collection in dataModel. For foreign-key-like fields use type "reference" and references { collection, field: "id" } so AppForge can visualize relationships. Do not create relationships to collections absent from dataModel.
Make the UI responsive, accessible, visually distinctive, and genuinely interactive.
For revisions, preserve existing useful behavior and implement the requested change instead of replacing the product concept.
Keep paths relative, never include secrets, and keep total output under 450 KB.`;

interface ClaudeMessageResponse {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function isSafePath(path: string): boolean {
  return Boolean(path) && !path.startsWith("/") && !path.includes("..") && !path.includes("\\");
}

function normalizeGenerated(parsed: Partial<GeneratedApp>): GeneratedApp | null {
  if (typeof parsed.title !== "string" || typeof parsed.description !== "string" || typeof parsed.html !== "string") return null;
  const files = Array.isArray(parsed.files)
    ? parsed.files.filter((file): file is { path: string; content: string } => Boolean(file) && typeof file.path === "string" && typeof file.content === "string" && isSafePath(file.path)).slice(0, 40)
    : [];
  if (!files.some((file) => file.path === "index.html")) files.unshift({ path: "index.html", content: parsed.html });
  const allowedTypes = new Set(["text", "number", "boolean", "date", "datetime", "reference"]);
  const collectionNames = new Set(Array.isArray(parsed.dataModel)
    ? parsed.dataModel.flatMap((collection) => collection && typeof collection.name === "string" ? [collection.name] : [])
    : []);
  const dataModel = Array.isArray(parsed.dataModel) ? parsed.dataModel.flatMap((collection) => {
    if (!collection || typeof collection.name !== "string" || !/^[a-z][a-z0-9_-]{0,47}$/.test(collection.name)) return [];
    const fields = Array.isArray(collection.fields) ? collection.fields.flatMap((field) => {
      if (!field || typeof field.name !== "string" || !/^[a-z][a-zA-Z0-9_]{0,47}$/.test(field.name) || !allowedTypes.has(field.type)) return [];
      const references = field.type === "reference" && field.references
        && typeof field.references.collection === "string" && collectionNames.has(field.references.collection)
        && typeof field.references.field === "string" && /^[a-z][a-zA-Z0-9_]{0,47}$/.test(field.references.field)
        ? { collection: field.references.collection, field: field.references.field }
        : undefined;
      if (field.type === "reference" && !references) return [];
      return [{ name: field.name, type: field.type, required: field.required === true, ...(references ? { references } : {}) }];
    }).slice(0, 40) : [];
    return [{ name: collection.name, fields }];
  }).slice(0, 20) as GeneratedApp["dataModel"] : [];
  return {
    title: parsed.title.slice(0, 80),
    description: parsed.description.slice(0, 240),
    summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 500) : "Generated a new application version.",
    html: parsed.html,
    files,
    dataModel,
  };
}

function parseGenerated(value: string): GeneratedApp | null {
  try {
    return normalizeGenerated(JSON.parse(stripCodeFence(value)) as Partial<GeneratedApp>);
  } catch {
    return null;
  }
}

function claudeEndpoint(env: Env): string | null {
  const base = env.ANTHROPIC_BASE_URL?.replace(/\/$/, "");
  if (base) return `${base}/v1/messages`;
  return env.ANTHROPIC_API_KEY ? "https://api.anthropic.com/v1/messages" : null;
}

export async function generateApp(
  env: Env,
  prompt: string,
  previousArtifact: AppArtifact | null,
  usage: { tenantId: string; appId: string; versionId: string },
): Promise<GeneratedApp> {
  const endpoint = claudeEndpoint(env);
  if (!endpoint || (!env.ANTHROPIC_API_KEY && !env.AI_GATEWAY_TOKEN)) return createFallbackApp(prompt);

  const previous = previousArtifact
    ? `\n<previous_artifact>\n${JSON.stringify(previousArtifact).slice(0, 220_000)}\n</previous_artifact>`
    : "";
  const headers = new Headers({ "content-type": "application/json", "anthropic-version": "2023-06-01" });
  if (env.ANTHROPIC_API_KEY) headers.set("x-api-key", env.ANTHROPIC_API_KEY);
  if (env.AI_GATEWAY_TOKEN) headers.set("cf-aig-authorization", `Bearer ${env.AI_GATEWAY_TOKEN}`);
  const model = env.ANTHROPIC_MODEL ?? "claude-sonnet-5";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 16_000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: `<user_request>\n${prompt}\n</user_request>${previous}` }],
      }),
    });
    const payload = await response.json() as ClaudeMessageResponse & { error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message ?? `Claude API returned ${response.status}`);
    const text = payload.content?.filter((item) => item.type === "text").map((item) => item.text ?? "").join("") ?? "";
    const generated = parseGenerated(text);
    if (!generated) throw new Error("Claude returned an invalid application artifact.");
    await env.DB.prepare(`INSERT INTO ai_usage (id, tenant_id, app_id, version_id, provider, model, input_tokens, output_tokens, created_at)
      VALUES (?, ?, ?, ?, 'anthropic', ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), usage.tenantId, usage.appId, usage.versionId, model, payload.usage?.input_tokens ?? 0, payload.usage?.output_tokens ?? 0, new Date().toISOString()).run();
    return generated;
  } catch (error) {
    console.error("Claude generation failed; using the deterministic fallback.", error);
    return createFallbackApp(prompt);
  }
}
