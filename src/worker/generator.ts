import { stripCodeFence } from "./html";
import { createFallbackApp } from "./templates";
import type { Env, GeneratedApp } from "./types";

const SYSTEM_PROMPT = `You are a senior product designer and frontend engineer building a small, polished web app.
Return JSON only with exactly three string fields: title, description, html.
The html must be a complete self-contained HTML document with inline CSS and JavaScript.
Do not use external assets, fetch, network requests, CDNs, iframes, eval, or dynamic script creation.
Make the UI responsive, accessible, visually distinctive, and genuinely interactive.
Keep all visible copy concise. The generated page runs in a sandbox.`;

function parseGenerated(value: unknown): GeneratedApp | null {
  const candidate = value && typeof value === "object" && "response" in value
    ? (value as { response: unknown }).response
    : value;
  if (typeof candidate === "object" && candidate !== null) {
    const object = candidate as Partial<GeneratedApp>;
    if (typeof object.title === "string" && typeof object.description === "string" && typeof object.html === "string") {
      return object as GeneratedApp;
    }
  }
  if (typeof candidate !== "string") return null;
  try {
    const parsed = JSON.parse(stripCodeFence(candidate)) as Partial<GeneratedApp>;
    if (typeof parsed.title === "string" && typeof parsed.description === "string" && typeof parsed.html === "string") {
      return parsed as GeneratedApp;
    }
  } catch {
    return null;
  }
  return null;
}

export async function generateApp(env: Env, prompt: string, previousHtml?: string | null): Promise<GeneratedApp> {
  if (!env.AI) return createFallbackApp(prompt);

  const revisionContext = previousHtml
    ? `\nThis is a revision. Preserve useful behavior from the prior app while applying the new request.\nPrior HTML:\n${previousHtml.slice(0, 80_000)}`
    : "";

  try {
    const result = await env.AI.run(env.AI_MODEL ?? "@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `<user_request>\n${prompt}\n</user_request>${revisionContext}` },
      ],
      max_tokens: 8_000,
      temperature: 0.45,
      response_format: { type: "json_object" },
    });
    return parseGenerated(result) ?? createFallbackApp(prompt);
  } catch (error) {
    console.warn("Workers AI generation failed; using the deterministic fallback.", error);
    return createFallbackApp(prompt);
  }
}

