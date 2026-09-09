CREATE TABLE IF NOT EXISTS runtime_tokens (
  version_id TEXT PRIMARY KEY REFERENCES app_versions(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_runtime_tokens_app ON runtime_tokens(tenant_id, app_id, revoked_at);
