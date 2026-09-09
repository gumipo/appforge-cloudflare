import type { AppDetail, AppSummary, CreateAppResponse, HealthInfo, SessionInfo, WorkspaceInvite, WorkspaceMember } from "../shared/types";

let tenantId = typeof window !== "undefined" ? window.localStorage.getItem("appforge:tenant") : null;

export function selectTenant(id: string): void {
  tenantId = id;
  window.localStorage.setItem("appforge:tenant", id);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (tenantId) headers.set("x-appforge-tenant", tenantId);
  const response = await fetch(url, { ...init, headers });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed with ${response.status}`);
  return data;
}

export async function fetchSession(): Promise<SessionInfo> {
  let session: SessionInfo;
  try {
    session = (await request<{ session: SessionInfo }>("/api/session")).session;
  } catch (error) {
    if (!tenantId) throw error;
    tenantId = null;
    window.localStorage.removeItem("appforge:tenant");
    session = (await request<{ session: SessionInfo }>("/api/session")).session;
  }
  if (!tenantId) selectTenant(session.tenant.id);
  return session;
}

export async function fetchHealth(): Promise<HealthInfo> {
  return request<HealthInfo>("/api/health");
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

export async function publishAppVersion(appId: string, versionId: string): Promise<AppDetail> {
  return (await request<CreateAppResponse>(`/api/apps/${appId}/versions/${versionId}/publish`, { method: "POST" })).app;
}

export async function fetchWorkspacePeople(): Promise<{ members: WorkspaceMember[]; invites: WorkspaceInvite[] }> {
  return request("/api/tenants/current/members");
}

export async function inviteWorkspaceMember(email: string, role: WorkspaceInvite["role"]): Promise<WorkspaceInvite> {
  return (await request<{ invite: WorkspaceInvite }>("/api/tenants/current/invites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, role }),
  })).invite;
}

export async function createWorkspace(name: string): Promise<{ id: string; name: string }> {
  return (await request<{ tenant: { id: string; name: string } }>("/api/tenants", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  })).tenant;
}
