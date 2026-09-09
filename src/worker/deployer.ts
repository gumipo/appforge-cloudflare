import type { Env } from "./types";

interface CloudflareEnvelope<T> {
  success: boolean;
  result: T;
  errors?: Array<{ message?: string }>;
}

function requireProductionCredentials(env: Env): {
  accountId: string;
  apiToken: string;
  subdomain: string;
} | null {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN || !env.CF_WORKERS_SUBDOMAIN) return null;
  return {
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: env.CLOUDFLARE_API_TOKEN,
    subdomain: env.CF_WORKERS_SUBDOMAIN,
  };
}

async function cloudflareRequest<T>(url: string, token: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  const payload = (await response.json()) as CloudflareEnvelope<T>;
  if (!response.ok || !payload.success) {
    throw new Error(payload.errors?.map((item) => item.message).filter(Boolean).join(", ") || `Cloudflare API returned ${response.status}`);
  }
  return payload.result;
}

export async function deployGeneratedHtml(env: Env, workerName: string, html: string): Promise<string | null> {
  const credentials = requireProductionCredentials(env);
  if (!credentials) return null;

  const workerModule = `const html=${JSON.stringify(html)};export default{async fetch(){return new Response(html,{headers:{"content-type":"text/html; charset=utf-8","x-content-type-options":"nosniff","referrer-policy":"no-referrer","cache-control":"public, max-age=60"}})}};`;
  const data = new FormData();
  data.append(
    "metadata",
    new Blob([JSON.stringify({ main_module: "worker.mjs", compatibility_date: "2026-09-01" })], { type: "application/json" }),
  );
  data.append("worker.mjs", new Blob([workerModule], { type: "application/javascript+module" }), "worker.mjs");

  const base = `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/workers/scripts/${workerName}`;
  await cloudflareRequest(base, credentials.apiToken, { method: "PUT", body: data });
  await cloudflareRequest(`${base}/subdomain`, credentials.apiToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, previews_enabled: true }),
  });

  return `https://${workerName}.${credentials.subdomain}.workers.dev`;
}

export interface DeploymentTarget {
  workerName: string;
  platform: "workers-for-platforms" | "workers";
  directUrl: string | null;
}

export async function deployVersionedHtml(
  env: Env,
  workerName: string,
  html: string,
  tags: string[] = [],
): Promise<DeploymentTarget | null> {
  const credentials = requireProductionCredentials(env);
  if (!credentials) return null;
  const workerModule = `const html=${JSON.stringify(html)};export default{async fetch(){return new Response(html,{headers:{"content-type":"text/html; charset=utf-8","x-content-type-options":"nosniff","referrer-policy":"no-referrer","cache-control":"public, max-age=60"}})}};`;
  const metadata: Record<string, unknown> = { main_module: "worker.mjs", compatibility_date: "2026-09-01" };
  if (env.WFP_NAMESPACE) metadata.tags = tags.slice(0, 8);
  const data = new FormData();
  data.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  data.append("worker.mjs", new Blob([workerModule], { type: "application/javascript+module" }), "worker.mjs");

  if (env.WFP_NAMESPACE) {
    const url = `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/workers/dispatch/namespaces/${env.WFP_NAMESPACE}/scripts/${workerName}`;
    await cloudflareRequest(url, credentials.apiToken, { method: "PUT", body: data });
    return { workerName, platform: "workers-for-platforms", directUrl: null };
  }

  const base = `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/workers/scripts/${workerName}`;
  await cloudflareRequest(base, credentials.apiToken, { method: "PUT", body: data });
  await cloudflareRequest(`${base}/subdomain`, credentials.apiToken, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, previews_enabled: true }),
  });
  return { workerName, platform: "workers", directUrl: `https://${workerName}.${credentials.subdomain}.workers.dev` };
}
