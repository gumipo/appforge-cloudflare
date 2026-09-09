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

interface WorkersAiResponse {
  response?: unknown;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  choices?: Array<{ message?: { content?: unknown } }>;
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
  const stripped = stripCodeFence(value);
  const candidates = [stripped];
  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(stripped.slice(firstBrace, lastBrace + 1));

  for (const candidate of candidates) {
    try {
      const generated = normalizeGenerated(JSON.parse(candidate) as Partial<GeneratedApp>);
      if (generated) return generated;
    } catch {
      // Try the next candidate when a model adds a short preamble around the JSON.
    }
  }
  return null;
}

function generatedFromWorkersPayload(payload: unknown): GeneratedApp | null {
  if (typeof payload === "string") return parseGenerated(payload);
  if (!payload || typeof payload !== "object") return null;
  const result = payload as WorkersAiResponse;
  if (result.response && typeof result.response === "object") {
    const generated = normalizeGenerated(result.response as Partial<GeneratedApp>);
    if (generated) return generated;
  }
  if (typeof result.response === "string") return parseGenerated(result.response);
  const content = result.choices?.[0]?.message?.content;
  if (typeof content === "string") return parseGenerated(content);
  if (content && typeof content === "object") return normalizeGenerated(content as Partial<GeneratedApp>);
  return normalizeGenerated(result as Partial<GeneratedApp>);
}

function claudeEndpoint(env: Env): string | null {
  const base = env.ANTHROPIC_BASE_URL?.replace(/\/$/, "");
  if (base) return `${base}/v1/messages`;
  return env.ANTHROPIC_API_KEY ? "https://api.anthropic.com/v1/messages" : null;
}

function requestedProvider(env: Env): "workers-ai" | "anthropic" | "fallback" {
  if (env.AI_PROVIDER) return env.AI_PROVIDER;
  if (env.AI) return "workers-ai";
  return claudeEndpoint(env) ? "anthropic" : "fallback";
}

function artifactContext(previousArtifact: AppArtifact | null, maxLength: number): string {
  if (!previousArtifact) return "";
  return `\n<previous_artifact>\n${JSON.stringify(previousArtifact).slice(0, maxLength)}\n</previous_artifact>`;
}

async function recordUsage(
  env: Env,
  usage: { tenantId: string; appId: string; versionId: string },
  provider: "workers-ai" | "anthropic",
  model: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  await env.DB.prepare(`INSERT INTO ai_usage (id, tenant_id, app_id, version_id, provider, model, input_tokens, output_tokens, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), usage.tenantId, usage.appId, usage.versionId, provider, model, inputTokens, outputTokens, new Date().toISOString()).run();
}

async function generateWithWorkersAi(
  env: Env,
  prompt: string,
  previousArtifact: AppArtifact | null,
  usage: { tenantId: string; appId: string; versionId: string },
): Promise<GeneratedApp> {
  if (!env.AI) return createFallbackApp(prompt);
  const model = env.WORKERS_AI_MODEL ?? "@cf/qwen/qwen2.5-coder-32b-instruct";

  try {
    const payload = await env.AI.run(model, {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `<user_request>\n${prompt}\n</user_request>${artifactContext(previousArtifact, 60_000)}` },
      ],
      max_tokens: 12_000,
      temperature: 0.2,
    }) as WorkersAiResponse | string;
    const generated = generatedFromWorkersPayload(payload);
    if (!generated) throw new Error("Workers AI returned an invalid application artifact.");
    const tokenUsage = typeof payload === "string" ? undefined : payload.usage;
    await recordUsage(env, usage, "workers-ai", model, tokenUsage?.prompt_tokens ?? 0, tokenUsage?.completion_tokens ?? 0);
    return generated;
  } catch (error) {
    console.error("Workers AI generation failed; using the deterministic fallback.", error);
    return createFallbackApp(prompt);
  }
}

async function generateWithClaude(
  env: Env,
  prompt: string,
  previousArtifact: AppArtifact | null,
  usage: { tenantId: string; appId: string; versionId: string },
): Promise<GeneratedApp> {
  const endpoint = claudeEndpoint(env);
  if (!endpoint || (!env.ANTHROPIC_API_KEY && !env.AI_GATEWAY_TOKEN)) return createFallbackApp(prompt);

  const previous = artifactContext(previousArtifact, 220_000);
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
    await recordUsage(env, usage, "anthropic", model, payload.usage?.input_tokens ?? 0, payload.usage?.output_tokens ?? 0);
    return generated;
  } catch (error) {
    console.error("Claude generation failed; using the deterministic fallback.", error);
    return createFallbackApp(prompt);
  }
}

export async function generateApp(
  env: Env,
  prompt: string,
  previousArtifact: AppArtifact | null,
  usage: { tenantId: string; appId: string; versionId: string },
): Promise<GeneratedApp> {
  const provider = requestedProvider(env);
  if (provider === "workers-ai") return generateWithWorkersAi(env, prompt, previousArtifact, usage);
  if (provider === "anthropic") return generateWithClaude(env, prompt, previousArtifact, usage);
  return createFallbackApp(prompt);
}
