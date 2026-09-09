export type AppStatus = "queued" | "building" | "ready" | "failed";

export interface AppSummary {
  id: string;
  slug: string;
  title: string;
  prompt: string;
  description: string;
  status: AppStatus;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  errorMessage: string | null;
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
}

export interface CreateAppRequest {
  prompt: string;
}

export interface CreateAppResponse {
  app: AppDetail;
}

