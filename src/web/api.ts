import type { AppDetail, AppSummary, CreateAppResponse } from "../shared/types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed with ${response.status}`);
  return data;
}

export async function fetchApps(): Promise<AppSummary[]> {
  return (await request<{ apps: AppSummary[] }>("/api/apps")).apps;
}

export async function fetchApp(id: string): Promise<AppDetail> {
  return (await request<{ app: AppDetail }>(`/api/apps/${id}`)).app;
}

export async function createApp(prompt: string): Promise<AppDetail> {
  return (await request<CreateAppResponse>("/api/apps", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt }),
  })).app;
}

export async function reviseApp(id: string, prompt: string): Promise<AppDetail> {
  return (await request<CreateAppResponse>(`/api/apps/${id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt }),
  })).app;
}

