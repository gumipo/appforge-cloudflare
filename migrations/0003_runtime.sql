CREATE TABLE IF NOT EXISTS tenant_invites (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_by TEXT NOT NULL REFERENCES users(id),
  accepted_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  accepted_at TEXT,
  UNIQUE (tenant_id, email)
);

CREATE TABLE IF NOT EXISTS app_records (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (app_id, collection, id)
);

CREATE INDEX IF NOT EXISTS idx_invites_email ON tenant_invites(email, status);
CREATE INDEX IF NOT EXISTS idx_records_tenant_app ON app_records(tenant_id, app_id, collection, updated_at DESC);
