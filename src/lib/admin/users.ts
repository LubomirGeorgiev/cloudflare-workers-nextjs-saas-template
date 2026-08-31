import "server-only";

import { eq, like, sql } from "drizzle-orm";

import { ROLES_ENUM, type UserRole } from "@/app/enums";
import { getDB } from "@/db";
import { userTable } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import { revokeInternalApiKeysForUser } from "@/lib/admin/admin-api-keys";
import { updateAllSessionsOfUser } from "@/utils/kv-session";

// Shared user administration, so the admin panel actions and the internal REST/MCP surface run one
// code path instead of each querying D1 their own way.
//
// Deliberately *not* self-authenticating, unlike `createApiKey`. The two doors authorize
// differently — the panel with a cookie session (`requireAdmin`) and the internal API with a bearer
// credential (`assertAdminPrincipal`, which also re-reads the live role) — so authorization stays
// at the door and this module stays a pure data layer. Never mount one of these on a route without
// a guard ahead of it.

/** Projection every admin listing shows; never widens to the password or token columns. */
const ADMIN_USER_COLUMNS = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  emailVerified: true,
  createdAt: true,
  lastActiveAt: true,
} as const;

export interface AdminUserSummary {
  id: string;
  email: string | null;
  name: string | null;
  role: UserRole;
  status: "active" | "inactive";
  createdAt: Date;
  lastActiveAt: Date | null;
}

export interface AdminUserPage {
  users: AdminUserSummary[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface AdminUserRow {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: UserRole;
  emailVerified: Date | null;
  createdAt: Date;
  lastActiveAt: Date | null;
}

function toSummary(user: AdminUserRow): AdminUserSummary {
  return {
    id: user.id,
    email: user.email,
    name: user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : null,
    role: user.role,
    status: user.emailVerified ? "active" : "inactive",
    createdAt: user.createdAt,
    lastActiveAt: user.lastActiveAt,
  };
}

export async function listAdminUsers({
  page,
  pageSize,
  emailFilter,
}: {
  page: number;
  pageSize: number;
  emailFilter?: string;
}): Promise<AdminUserPage> {
  const db = getDB();
  const offset = (page - 1) * pageSize;

  // The count and the page must filter identically, so the pattern is written once and both sides
  // express it with a drizzle `like`, rather than one raw SQL fragment beside one relational filter.
  const emailPattern = emailFilter ? `%${emailFilter}%` : null;

  const [[{ count }], users] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)` })
      .from(userTable)
      .where(emailPattern ? like(userTable.email, emailPattern) : undefined),
    db.query.userTable.findMany({
      columns: ADMIN_USER_COLUMNS,
      where: emailPattern ? { email: { like: emailPattern } } : undefined,
      orderBy: { createdAt: "desc" },
      limit: pageSize,
      offset,
    }),
  ]);

  return {
    users: users.map(toSummary),
    totalCount: count,
    page,
    pageSize,
    totalPages: Math.ceil(count / pageSize),
  };
}

export async function getAdminUserSummary({ userId }: { userId: string }): Promise<AdminUserSummary> {
  const user = await getDB().query.userTable.findFirst({
    where: { id: userId },
    columns: ADMIN_USER_COLUMNS,
  });

  if (!user) {
    throw new ActionError("NOT_FOUND", "User not found");
  }

  return toSummary(user);
}

/** Adds the columns only the one-user page shows to the listing projection. */
const ADMIN_USER_DETAIL_COLUMNS = {
  ...ADMIN_USER_COLUMNS,
  avatar: true,
  updatedAt: true,
  signUpIpAddress: true,
  googleAccountId: true,
  passwordHash: true,
} as const;

const ADMIN_PASSKEY_COLUMNS = {
  id: true,
  aaguid: true,
  counter: true,
  userAgent: true,
  createdAt: true,
} as const;

interface AdminUserDetail {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  avatar: string | null;
  role: UserRole;
  emailVerified: Date | null;
  /** The hash itself never leaves this module; the page only reports whether one is set. */
  hasPassword: boolean;
  googleAccountId: string | null;
  signUpIpAddress: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastActiveAt: Date | null;
  passkeys: AdminUserPasskey[];
}

export interface AdminUserPasskey {
  id: string;
  aaguid: string | null;
  counter: number;
  userAgent: string | null;
  createdAt: Date;
}

export async function getAdminUserDetail({ userId }: { userId: string }): Promise<AdminUserDetail> {
  const db = getDB();

  const [user, passkeys] = await Promise.all([
    db.query.userTable.findFirst({ where: { id: userId }, columns: ADMIN_USER_DETAIL_COLUMNS }),
    db.query.passKeyCredentialTable.findMany({
      where: { userId },
      columns: ADMIN_PASSKEY_COLUMNS,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  if (!user) {
    throw new ActionError("NOT_FOUND", "User not found");
  }

  const { passwordHash, ...rest } = user;

  return { ...rest, hasPassword: Boolean(passwordHash), passkeys };
}

function logDemotionCleanupFailure(step: string) {
  return (error: unknown) => {
    console.error(`Role demotion cleanup failed: ${step}`, error);
  };
}

// Imported on demotion, never at module scope. The grant module reaches the OAuth provider, which
// pulls `cloudflare:workers` in through a node_modules dependency the build-time OpenAPI generator
// cannot resolve outside workerd — and this file is on that generator's module graph.
async function revokeInternalOAuthGrants(userId: string): Promise<number> {
  const { revokeInternalOAuthGrantsForUser } = await import("@/lib/admin/admin-oauth-grants");

  return revokeInternalOAuthGrantsForUser(userId);
}

/**
 * Change a user's role. This is the only path in the app that writes `user.role`; the column has no
 * other writer, so anything else is a direct database edit.
 *
 * Three things have to happen, in this order:
 *
 * 1. Write the row. The internal API's guard re-reads the role from D1 on every request, so an
 *    admin credential loses its power here — before any cache is touched.
 * 2. Revoke the user's internal credentials when they are no longer an admin: their API keys and
 *    their OAuth grants alike. Step 1 already made both powerless, but a powerless credential is
 *    still live. An internal key is invisible to its owner — the owner-facing listings exclude it
 *    and `/admin/api` needs the role they just lost — and a grant still shows `admin:*` on their
 *    account settings and would come back on a later promotion with no fresh consent.
 * 3. Refresh sessions, which is also the one purge site for bearer snapshots. It must come last,
 *    or the revoked credentials' snapshots outlive their revocation until the cache TTL lapses.
 *
 * Step 2 runs whenever the new role is not admin, rather than only on an admin-to-user transition.
 * A user who was never an admin cannot hold either credential, so the reads find nothing — and if
 * one ever did survive a direct database demotion, this repairs it.
 */
export async function setUserRole({
  userId,
  role,
}: {
  userId: string;
  role: UserRole;
}): Promise<AdminUserSummary> {
  const db = getDB();

  const updated = await db
    .update(userTable)
    .set({ role })
    .where(eq(userTable.id, userId))
    .returning({ id: userTable.id });

  if (updated.length === 0) {
    throw new ActionError("NOT_FOUND", "User not found");
  }

  if (role !== ROLES_ENUM.ADMIN) {
    // D1 has no transactions, so the role write is already durable and neither cleanup may stop
    // step 3 — the cookie session carries the old role until it is refreshed, and `requireAdmin`
    // trusts it. Each gets its own `.catch`, so one store failing cannot skip the other.
    await Promise.all([
      revokeInternalApiKeysForUser(userId).catch(logDemotionCleanupFailure("internal API keys")),
      revokeInternalOAuthGrants(userId).catch(logDemotionCleanupFailure("internal OAuth grants")),
    ]);
  }

  await updateAllSessionsOfUser(userId);

  return getAdminUserSummary({ userId });
}
