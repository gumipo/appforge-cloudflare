import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AuthContext, Env } from "./types";

type Role = AuthContext["tenant"]["role"];
interface AccessIdentity { id: string; email: string; name: string; avatarUrl: string | null }
const jwksByTeam = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export class AuthError extends Error {
  constructor(message: string, public readonly status: 401 | 403 | 503 = 401) { super(message); }
}

function developmentIdentity(): AccessIdentity {
  return { id: "dev-user", email: "developer@appforge.local", name: "Local developer", avatarUrl: null };
}

function normalizeTeamDomain(value: string): string {
  return value.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

async function verifyAccessIdentity(request: Request, env: Env): Promise<AccessIdentity> {
  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) throw new AuthError("Cloudflare Access authentication is required.");
  if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) throw new AuthError("Cloudflare Access is not configured.", 503);
  const teamDomain = normalizeTeamDomain(env.CF_ACCESS_TEAM_DOMAIN);
  let jwks = jwksByTeam.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    jwksByTeam.set(teamDomain, jwks);
  }
  const { payload } = await jwtVerify(token, jwks, { audience: env.CF_ACCESS_AUD, issuer: `https://${teamDomain}` });
  const email = typeof payload.email === "string" ? payload.email : null;
  const id = typeof payload.sub === "string" ? payload.sub : null;
  if (!email || !id) throw new AuthError("Cloudflare Access identity is incomplete.");
  return {
    id,
    email,
    name: typeof payload.name === "string" ? payload.name : email.split("@")[0],
    avatarUrl: typeof payload.picture === "string" ? payload.picture : null,
  };
}

function tenantSlug(identity: AccessIdentity): string {
  const prefix = identity.email.split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
  return `${prefix}-${identity.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toLowerCase()}`;
}

export async function hashRuntimeToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function authenticateRuntime(request: Request, env: Env): Promise<AuthContext> {
  const token = request.headers.get("x-appforge-runtime-token");
  if (!token || token.length < 32 || token.length > 256) throw new AuthError("Invalid app runtime token.");
  const tokenHash = await hashRuntimeToken(token);
  const row = await env.DB.prepare(`SELECT rt.tenant_id AS tenantId, rt.app_id AS appId, t.slug, t.name AS tenantName,
      u.id AS userId, u.email, u.name AS userName, u.avatar_url AS avatarUrl
    FROM runtime_tokens rt
    JOIN tenants t ON t.id = rt.tenant_id
    JOIN apps a ON a.id = rt.app_id AND a.tenant_id = rt.tenant_id
    JOIN users u ON u.id = a.created_by
    WHERE rt.token_hash = ? AND rt.revoked_at IS NULL`)
    .bind(tokenHash).first<{ tenantId: string; appId: string; slug: string; tenantName: string; userId: string; email: string; userName: string; avatarUrl: string | null }>();
  if (!row) throw new AuthError("Invalid or revoked app runtime token.");
  const tenant = { id: row.tenantId, slug: row.slug, name: row.tenantName, role: "editor" as const };
  return {
    user: { id: row.userId, email: row.email, name: row.userName, avatarUrl: row.avatarUrl },
    tenant,
    tenants: [tenant],
    authMode: "access",
    runtimeAppId: row.appId,
  };
}

export async function authenticate(request: Request, env: Env): Promise<AuthContext> {
  const development = env.ENVIRONMENT === "development" || env.AUTH_MODE === "development";
  const identity = development ? developmentIdentity() : await verifyAccessIdentity(request, env);
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO users (id, email, name, avatar_url, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name, avatar_url = excluded.avatar_url, last_seen_at = excluded.last_seen_at`)
    .bind(identity.id, identity.email, identity.name, identity.avatarUrl, now, now).run();

  const invites = await env.DB.prepare(`SELECT id, tenant_id, role FROM tenant_invites
    WHERE lower(email) = lower(?) AND status = 'pending'`).bind(identity.email).all<{ id: string; tenant_id: string; role: Role }>();
  if (invites.results.length) {
    await env.DB.batch(invites.results.flatMap((invite) => [
      env.DB.prepare(`INSERT INTO memberships (tenant_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(tenant_id, user_id) DO UPDATE SET role = excluded.role`).bind(invite.tenant_id, identity.id, invite.role, now),
      env.DB.prepare("UPDATE tenant_invites SET status = 'accepted', accepted_by = ?, accepted_at = ? WHERE id = ?")
        .bind(identity.id, now, invite.id),
    ]));
  }

  let memberships = await env.DB.prepare(`SELECT t.id, t.slug, t.name, m.role FROM memberships m JOIN tenants t ON t.id = m.tenant_id
    WHERE m.user_id = ? ORDER BY t.created_at ASC`).bind(identity.id).all<{ id: string; slug: string; name: string; role: Role }>();
  if (!memberships.results.length) {
    const id = crypto.randomUUID();
    const slug = tenantSlug(identity);
    const name = `${identity.name}'s workspace`;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO tenants (id, slug, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)").bind(id, slug, name, identity.id, now),
      env.DB.prepare("INSERT INTO memberships (tenant_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").bind(id, identity.id, now),
    ]);
    memberships = { ...memberships, results: [{ id, slug, name, role: "owner" }] };
  }
  const requestedTenant = request.headers.get("x-appforge-tenant");
  const tenant = memberships.results.find((item) => item.id === requestedTenant || item.slug === requestedTenant) ?? memberships.results[0];
  if (requestedTenant && !memberships.results.some((item) => item.id === requestedTenant || item.slug === requestedTenant)) {
    throw new AuthError("You do not have access to this workspace.", 403);
  }
  return { user: identity, tenant, tenants: memberships.results, authMode: development ? "development" : "access" };
}

export function requireEditor(auth: AuthContext): void {
  if (auth.tenant.role === "viewer") throw new AuthError("Editor access is required.", 403);
}

export function requireAdmin(auth: AuthContext): void {
  if (auth.tenant.role !== "owner" && auth.tenant.role !== "admin") {
    throw new AuthError("Workspace administrator access is required.", 403);
  }
}
