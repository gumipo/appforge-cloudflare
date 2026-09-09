import type { AppStatus } from "../shared/types";

export interface BuildJob {
  appId: string;
  origin: string;
}

interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

interface BrowserBinding {
  quickAction(action: "screenshot", options: Record<string, unknown>): Promise<Response>;
}

export interface Env {
  DB: D1Database;
  BUILDS?: Queue<BuildJob>;
  THUMBNAILS?: R2Bucket;
  ASSETS?: Fetcher;
  AI?: AiBinding;
  BROWSER?: BrowserBinding;
  ENVIRONMENT?: "development" | "production";
  AI_MODEL?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CF_WORKERS_SUBDOMAIN?: string;
}

export interface AppRow {
  id: string;
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
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: string;
  app_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface GeneratedApp {
  title: string;
  description: string;
  html: string;
}

