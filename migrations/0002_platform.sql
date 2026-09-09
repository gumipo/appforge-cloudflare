CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'editor', 'viewer')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);

INSERT OR IGNORE INTO users (id, email, name, created_at, last_seen_at)
VALUES ('dev-user', 'developer@appforge.local', 'Local developer', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO tenants (id, slug, name, created_by, created_at)
VALUES ('dev-tenant', 'local-workspace', 'Local workspace', 'dev-user', datetime('now'));

INSERT OR IGNORE INTO memberships (tenant_id, user_id, role, created_at)
VALUES ('dev-tenant', 'dev-user', 'owner', datetime('now'));

ALTER TABLE apps ADD COLUMN tenant_id TEXT;
ALTER TABLE apps ADD COLUMN created_by TEXT;
ALTER TABLE apps ADD COLUMN latest_version_id TEXT;
ALTER TABLE apps ADD COLUMN published_version_id TEXT;
ALTER TABLE apps ADD COLUMN app_database_id TEXT;

UPDATE apps SET tenant_id = 'dev-tenant' WHERE tenant_id IS NULL;
UPDATE apps SET created_by = 'dev-user' WHERE created_by IS NULL;

CREATE TABLE IF NOT EXISTS app_versions (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'building', 'ready', 'published', 'failed', 'archived')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL,
  source_key TEXT,
  source_html TEXT,
  source_hash TEXT,
  preview_url TEXT,
  worker_name TEXT,
  thumbnail_key TEXT,
  error_message TEXT,
  created_by TEXT,
  based_on_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  UNIQUE (app_id, version_number)
);

INSERT INTO app_versions (
  id, app_id, version_number, status, title, description, summary, prompt,
  source_html, preview_url, worker_name, thumbnail_key, error_message,
  created_by, created_at, updated_at, published_at
)
SELECT
  'legacy-' || id, id, 1,
  CASE WHEN status = 'ready' THEN 'published' ELSE status END,
  title, description, 'Imported from the initial AppForge MVP.', prompt,
  source_html, preview_url, worker_name, thumbnail_key, error_message,
  created_by, created_at, updated_at,
  CASE WHEN status = 'ready' THEN updated_at ELSE NULL END
FROM apps
WHERE NOT EXISTS (SELECT 1 FROM app_versions WHERE app_versions.app_id = apps.id);

UPDATE apps SET latest_version_id = (SELECT id FROM app_versions WHERE app_versions.app_id = apps.id ORDER BY version_number DESC LIMIT 1)
WHERE latest_version_id IS NULL;

UPDATE apps SET published_version_id = (SELECT id FROM app_versions WHERE app_versions.app_id = apps.id AND status = 'published' ORDER BY version_number DESC LIMIT 1)
WHERE published_version_id IS NULL;

ALTER TABLE messages ADD COLUMN user_id TEXT;
ALTER TABLE messages ADD COLUMN version_id TEXT;
UPDATE messages SET user_id = 'dev-user' WHERE role = 'user' AND user_id IS NULL;

ALTER TABLE builds ADD COLUMN version_id TEXT;

CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL REFERENCES app_versions(id) ON DELETE CASCADE,
  environment TEXT NOT NULL CHECK (environment IN ('preview', 'production')),
  status TEXT NOT NULL CHECK (status IN ('deploying', 'ready', 'failed')),
  worker_name TEXT,
  url TEXT,
  error_message TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS app_resources (
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,
  binding_name TEXT NOT NULL,
  resource_id TEXT,
  resource_name TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (app_id, resource_type, binding_name)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT,
  app_id TEXT,
  action TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  app_id TEXT,
  version_id TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_apps_tenant ON apps(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_versions_app ON app_versions(app_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_deployments_version ON deployments(version_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_tenant ON ai_usage(tenant_id, created_at DESC);

