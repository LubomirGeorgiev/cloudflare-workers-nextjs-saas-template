/// <reference types="@cloudflare/vitest-plugin/types" />

// `setUserRole` is the only path in the app that writes `user.role`, so it is also the only place
// that can clean up after a demotion. What is under test here is that it does: an internal key
// outlives its owner's admin role otherwise, and the owner-facing listings exclude internal keys,
// so nobody but another admin could ever find it again.
//
// Mocking mirrors api-key-service.test.ts: request-scoped identity is injected because
// requireVerifiedEmail and requireAdmin read next/headers cookies that do not exist in the
// Workers test pool.

import { beforeEach, expect, test, vi } from "vitest";

const { authState } = vi.hoisted(() => ({ authState: { current: null as unknown } }));

vi.mock("@/utils/auth", async (importOriginal) => {
  const { ActionError } = await import("@/lib/action-error");

  return {
    ...(await importOriginal<typeof import("@/utils/auth")>()),
    requireVerifiedEmail: async () => {
      if (!authState.current) {
        throw new ActionError("NOT_AUTHORIZED", { key: "Client.Errors.notAuthenticated" });
      }

      return authState.current;
    },
    requireAdmin: async () => authState.current,
    getCurrentSession: async () => authState.current,
  };
});

// The session refresh fans out to KV, which this suite does not exercise; the ordering it belongs
// to is documented and asserted in `setUserRole` itself, not here.
vi.mock("@/utils/kv-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/kv-session")>()),
  updateAllSessionsOfUser: async () => undefined,
}));

import { ROLES_ENUM } from "@/app/enums";
import { getDB } from "@/db";
import { apiKeyTable, userTable } from "@/db/schema";
import { createAdminApiKey, listAdminApiKeys } from "@/lib/admin/admin-api-keys";
import { setUserRole } from "@/lib/admin/users";
import { ADMIN_SCOPE_NAMES } from "@/lib/api/admin-scopes";
import { listUserApiKeys } from "@/lib/api-keys/api-keys";

const db = getDB();
const INTERNAL_SCOPE = ADMIN_SCOPE_NAMES[0];

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

async function seedAdmin(): Promise<string> {
  const userId = uid("usr");

  await db.insert(userTable).values({
    id: userId,
    email: `${userId}@example.com`,
    emailVerified: new Date(),
    role: ROLES_ENUM.ADMIN,
  });

  return userId;
}

function sessionFor(userId: string) {
  return {
    id: `sess_${userId}`,
    userId,
    user: { id: userId, email: `${userId}@example.com`, emailVerified: new Date() },
  } as unknown;
}

async function liveKeyScopes(userId: string): Promise<string[][]> {
  const rows = await db.query.apiKeyTable.findMany({
    where: { userId, revokedAt: { isNull: true } },
    columns: { scopes: true },
  });

  return rows.map((row) => row.scopes);
}

beforeEach(() => {
  authState.current = null;
});

test("demoting an admin revokes the internal keys they can no longer reach", async () => {
  const userId = await seedAdmin();
  authState.current = sessionFor(userId);

  await createAdminApiKey({ name: "Ops agent", scopes: [INTERNAL_SCOPE] });
  expect(await liveKeyScopes(userId)).toEqual([[INTERNAL_SCOPE]]);
  expect(await listAdminApiKeys()).toHaveLength(1);

  const demoted = await setUserRole({ userId, role: ROLES_ENUM.USER });

  expect(demoted.role).toBe(ROLES_ENUM.USER);
  expect(await liveKeyScopes(userId)).toEqual([]);
});

// The demoted user's own listings must not be the thing that hides the key: it has to be gone.
test("demotion deletes the internal key outright", async () => {
  const userId = await seedAdmin();
  authState.current = sessionFor(userId);

  await createAdminApiKey({ name: "Ops agent", scopes: [INTERNAL_SCOPE] });
  await setUserRole({ userId, role: ROLES_ENUM.USER });

  expect(await listAdminApiKeys()).toEqual([]);
  expect(await listUserApiKeys()).toEqual([]);

  // Deleted, not stamped: no listing ever showed a revoked row, so the tombstone bought nothing.
  const rows = await db.query.apiKeyTable.findMany({ where: { userId }, columns: { id: true } });

  expect(rows).toEqual([]);
});

// One rule: the demotion takes every internal row, so a key nobody could use any more is not left
// behind for the retention sweep to find.
test("demotion deletes an expired internal key and a revoked leftover too", async () => {
  const userId = await seedAdmin();
  authState.current = sessionFor(userId);

  await db.insert(apiKeyTable).values([
    {
      id: uid("akey"),
      userId,
      teamId: null,
      name: "Expired ops agent",
      keyHash: uid("hash"),
      keyPrefix: "sk_admin",
      last4: "abcd",
      scopes: [INTERNAL_SCOPE],
      expiresAt: new Date(Date.now() - 60_000),
    },
    {
      id: uid("akey"),
      userId,
      teamId: null,
      name: "Revoked ops agent",
      keyHash: uid("hash"),
      keyPrefix: "sk_admin",
      last4: "efgh",
      scopes: [INTERNAL_SCOPE],
      revokedAt: new Date(Date.now() - 60_000),
    },
  ]);

  await setUserRole({ userId, role: ROLES_ENUM.USER });

  const rows = await db.query.apiKeyTable.findMany({ where: { userId }, columns: { id: true } });

  expect(rows).toEqual([]);
});

test("a public key on the same account survives the demotion", async () => {
  const userId = await seedAdmin();
  authState.current = sessionFor(userId);

  await createAdminApiKey({ name: "Ops agent", scopes: [INTERNAL_SCOPE] });
  await db.insert(apiKeyTable).values({
    id: uid("akey"),
    userId,
    teamId: null,
    name: "Personal key",
    keyHash: uid("hash"),
    keyPrefix: "sk_test",
    last4: "abcd",
    scopes: ["profile:read"],
  });

  await setUserRole({ userId, role: ROLES_ENUM.USER });

  expect(await liveKeyScopes(userId)).toEqual([["profile:read"]]);
});

test("promoting a user revokes nothing", async () => {
  const userId = await seedAdmin();
  authState.current = sessionFor(userId);

  await createAdminApiKey({ name: "Ops agent", scopes: [INTERNAL_SCOPE] });
  await setUserRole({ userId, role: ROLES_ENUM.ADMIN });

  expect(await liveKeyScopes(userId)).toEqual([[INTERNAL_SCOPE]]);
});

// Self-healing: a key that survived a demotion done straight in the database is cleaned up the
// next time the role is set through the app, rather than needing a transition to be observed.
test("re-setting a non-admin role cleans up a key that survived a direct database demotion", async () => {
  const userId = await seedAdmin();
  authState.current = sessionFor(userId);

  await createAdminApiKey({ name: "Ops agent", scopes: [INTERNAL_SCOPE] });
  await db.update(userTable).set({ role: ROLES_ENUM.USER });

  await setUserRole({ userId, role: ROLES_ENUM.USER });

  expect(await liveKeyScopes(userId)).toEqual([]);
});
