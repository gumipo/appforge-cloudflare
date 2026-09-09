export type AppStatus = "queued" | "building" | "ready" | "failed";
export type VersionStatus = "queued" | "building" | "ready" | "published" | "failed" | "archived";
export type DataFieldType = "text" | "number" | "boolean" | "date" | "datetime" | "reference";

export interface DataModelField {
  name: string;
  type: DataFieldType;
  required: boolean;
  references?: { collection: string; field: string };
}

export interface DataCollection {
  name: string;
  fields: DataModelField[];
}

export interface UserSummary {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  role: "owner" | "admin" | "editor" | "viewer";
}

export interface SessionInfo {
  user: UserSummary;
  tenant: TenantSummary;
  tenants: TenantSummary[];
  authMode: "development" | "access";
}

export interface HealthInfo {
  ok: boolean;
  environment: string;
  aiProvider: "workers-ai" | "anthropic" | "fallback";
  aiReady: boolean;
}

export interface WorkspaceMember {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: TenantSummary["role"];
  joinedAt: string;
}

export interface WorkspaceInvite {
  id: string;
  email: string;
  role: Exclude<TenantSummary["role"], "owner">;
  status: "pending" | "accepted" | "revoked";
  createdAt: string;
}

export interface AppVersionSummary {
  id: string;
  appId: string;
  versionNumber: number;
  status: VersionStatus;
  title: string;
  description: string;
  summary: string;
  dataModel: DataCollection[];
  prompt: string;
  sourceKey: string | null;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  errorMessage: string | null;
  basedOnVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface AppSummary {
  id: string;
  tenantId: string;
  slug: string;
  title: string;
  prompt: string;
  description: string;
  status: AppStatus;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  errorMessage: string | null;
  latestVersionId: string | null;
  publishedVersionId: string | null;
  latestVersionNumber: number | null;
  publishedVersionNumber: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  appId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface AppDetail extends AppSummary {
  messages: ChatMessage[];
  versions: AppVersionSummary[];
}

export interface CreateAppRequest {
  prompt: string;
}

export interface CreateAppResponse {
  app: AppDetail;
}
