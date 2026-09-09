import type { AppStatus, VersionStatus } from "../shared/types";

export interface BuildJob {
  appId: string;
  versionId: string;
  tenantId: string;
  origin: string;
}

interface BrowserBinding {
  quickAction(action: "screenshot", options: Record<string, unknown>): Promise<Response>;
}

export interface Env {
  DB: D1Database;
  BUILDS?: Queue<BuildJob>;
  THUMBNAILS?: R2Bucket;
  ASSETS?: Fetcher;
  BROWSER?: BrowserBinding;
  DISPATCHER?: { get(name: string): Fetcher };
  ENVIRONMENT?: "development" | "production";
  AUTH_MODE?: "development" | "access";
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_MODEL?: string;
  AI_GATEWAY_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CF_WORKERS_SUBDOMAIN?: string;
  WFP_NAMESPACE?: string;
}

export interface AppRow {
  id: string;
  tenant_id: string;
  created_by: string | null;
  slug: string;
  title: string;
  prompt: string;
  description: string;
  status: AppStatus;
  preview_url: string | null;
  worker_name: string | null;
  thumbnail_key: string | null;
  source_html?: string | null;
  error_message: string | null;
  latest_version_id: string | null;
  published_version_id: string | null;
  app_database_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  app_id: string;
  role: "user" | "assistant";
  content: string;
  user_id: string | null;
  version_id: string | null;
  created_at: string;
}

export interface GeneratedApp {
  title: string;
  description: string;
  summary: string;
  html: string;
  files: Array<{ path: string; content: string }>;
  dataModel: Array<{
    name: string;
    fields: Array<{ name: string; type: "text" | "number" | "boolean" | "date" | "datetime"; required: boolean }>;
  }>;
}

export interface VersionRow {
  id: string;
  app_id: string;
  version_number: number;
  status: VersionStatus;
  title: string;
  description: string;
  summary: string;
  prompt: string;
  source_key: string | null;
  source_html: string | null;
  source_hash: string | null;
  preview_url: string | null;
  worker_name: string | null;
  thumbnail_key: string | null;
  error_message: string | null;
  created_by: string | null;
  based_on_version_id: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface AuthContext {
  user: { id: string; email: string; name: string; avatarUrl: string | null };
  tenant: { id: string; slug: string; name: string; role: "owner" | "admin" | "editor" | "viewer" };
  tenants: Array<{ id: string; slug: string; name: string; role: "owner" | "admin" | "editor" | "viewer" }>;
  authMode: "development" | "access";
  runtimeAppId?: string;
}

export interface AppArtifact {
  schemaVersion: 1;
  title: string;
  description: string;
  summary: string;
  entrypoint: string;
  files: Array<{ path: string; content: string }>;
  dataModel: GeneratedApp["dataModel"];
  generatedAt: string;
}
