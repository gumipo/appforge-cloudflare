import type { AppArtifact, Env, GeneratedApp, VersionRow } from "./types";

export async function hashSource(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function makeArtifact(generated: GeneratedApp, html: string): AppArtifact {
  const files = generated.files.filter((file) => file.path !== "index.html");
  files.unshift({ path: "index.html", content: html });
  return {
    schemaVersion: 1,
    title: generated.title,
    description: generated.description,
    summary: generated.summary,
    entrypoint: "index.html",
    files,
    dataModel: generated.dataModel,
    generatedAt: new Date().toISOString(),
  };
}

export async function saveArtifact(env: Env, tenantId: string, appId: string, versionNumber: number, artifact: AppArtifact): Promise<string | null> {
  if (!env.THUMBNAILS) return null;
  const key = `tenants/${tenantId}/apps/${appId}/versions/${versionNumber}/source.json`;
  await env.THUMBNAILS.put(key, JSON.stringify(artifact), {
    httpMetadata: { contentType: "application/json", cacheControl: "private, no-store" },
    customMetadata: { schemaVersion: String(artifact.schemaVersion), entrypoint: artifact.entrypoint },
  });
  return key;
}

export async function loadArtifact(env: Env, version: VersionRow | null): Promise<AppArtifact | null> {
  if (!version) return null;
  if (version.source_key && env.THUMBNAILS) {
    const object = await env.THUMBNAILS.get(version.source_key);
    if (object) {
      try { return await object.json<AppArtifact>(); } catch { /* fall through to legacy HTML */ }
    }
  }
  if (!version.source_html) return null;
  return {
    schemaVersion: 1,
    title: version.title,
    description: version.description,
    summary: version.summary,
    entrypoint: "index.html",
    files: [{ path: "index.html", content: version.source_html }],
    dataModel: [],
    generatedAt: version.updated_at,
  };
}

