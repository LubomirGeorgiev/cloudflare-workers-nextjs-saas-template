/// <reference types="@cloudflare/vitest-plugin/types" />

// Behavior coverage for the bearer hot path against a real D1 + KV. The invariants under test:
// a malformed token never reaches storage, a cache hit serves the principal without D1, and the
// three ways a key stops working (revoked, expired, snapshot version bumped) all fail closed.
//
// The auth mock exists for revokeApiKey, which authorizes through requireVerifiedEmail; the
// resolver itself is credential-driven and needs no request-scoped identity.

import { beforeEach, expect, test, vi } from "vitest";

const { authState } = vi.hoisted(() => ({ authState: { current: null as unknown } }));

vi.mock("@/utils/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/auth")>()),
  requireVerifiedEmail: async () => authState.current,
  getCurrentSession: async () => authState.current,
}));

import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";

import { API_KEY_CACHE_TTL_SECONDS, CURRENT_API_KEY_CACHE_VERSION } from "@/constants";
import { getDB } from "@/db";
import { apiKeyTable, teamTable, userTable } from "@/db/schema";
import { createApiKey, revokeApiKey, updateApiKeyScopes } from "@/lib/api-keys/api-keys";
import {
  API_SCOPE_NAMES,
  TEAM_KEY_SCOPES,
  isAccountOnlyScope,
  type ApiScope,
} from "@/lib/api/scopes";
import { generateApiKey } from "@/utils/api-key-format";
import { deleteApiKeyCache, getApiKeyPrincipal } from "@/utils/kv-api-key";
import { purgeUserPrincipalCaches } from "@/utils/kv-principal-purge";
import { hashToken } from "@/utils/random-token";

const db = getDB();
const SCOPE = API_SCOPE_NAMES[0];
// The narrowing this file covers only has a subject while the catalog still has one of each.
const ACCOUNT_ONLY_SCOPE = API_SCOPE_NAMES.find(isAccountOnlyScope);
const TEAM_SCOPE = TEAM_KEY_SCOPES[0];

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

function sessionFor(userId: string) {
  return {
    id: `sess_${userId}`,
    userId,
    user: { id: userId, email: `${userId}@example.com`, emailVerified: new Date() },
  } as unknown;
}

async function seedUser(): Promise<string> {
  const userId = uid("usr");
  await db.insert(userTable).values({
    id: userId,
    email: `${userId}@example.com`,
    firstName: "Api",
    lastName: "Caller",
    emailVerified: new Date(),
  });
  return userId;
}

// Writes the row directly so a test can control expiry/revocation without going through the
// service's authorization path.
async function seedKey({
  userId,
  expiresAt,
  teamId,
  scopes = [SCOPE],
}: {
  userId: string;
  expiresAt?: Date;
  teamId?: string;
  /** Written straight to D1, so a row the service would refuse today can still be staged here. */
  scopes?: ApiScope[];
}) {
  const generated = await generateApiKey();
  const id = uid("akey");

  await db.insert(apiKeyTable).values({
    id,
    userId,
    name: "resolver",
    keyHash: generated.hash,
    keyPrefix: generated.prefix,
    last4: generated.last4,
    scopes,
    expiresAt,
    teamId,
  });

  return { id, ...generated };
}

async function seedTeam(): Promise<string> {
  const teamId = uid("team");
  await db.insert(teamTable).values({ id: teamId, name: "Resolver Team", slug: uid("resolver") });

  return teamId;
}

function readSnapshot(keyHash: string) {
  return env.KV_STORE.get(`apikey:${keyHash}`);
}

beforeEach(() => {
  authState.current = null;
});

test("a malformed token is rejected without any storage lookup", async () => {
  const kvGet = vi.spyOn(env.KV_STORE, "get");

  expect(await getApiKeyPrincipal("garbage")).toBeNull();
  expect(await getApiKeyPrincipal("")).toBeNull();

  expect(kvGet).not.toHaveBeenCalled();
  kvGet.mockRestore();
});

test("a well-formed but unknown key resolves to null", async () => {
  const { secret } = await generateApiKey();

  expect(await getApiKeyPrincipal(secret)).toBeNull();
});

test("a cache miss rebuilds the principal from D1 and writes the snapshot back", async () => {
  const userId = await seedUser();
  const key = await seedKey({ userId });

  expect(await readSnapshot(key.hash)).toBeNull();

  const principal = await getApiKeyPrincipal(key.secret);

  expect(principal).toMatchObject({
    kind: "api-key",
    userId,
    keyId: key.id,
    scopes: [SCOPE],
  });
  expect(principal?.user.id).toBe(userId);

  const snapshot = JSON.parse((await readSnapshot(key.hash))!);
  expect(snapshot.version).toBe(CURRENT_API_KEY_CACHE_VERSION);
  expect(snapshot.keyId).toBe(key.id);
});

// The stored `teamId` is the key's audience, and it has to survive the cache: a snapshot that
// dropped it would silently promote a team key back to an account credential on every cache hit.
test("the key's team becomes the principal's audience, through the cache too", async () => {
  const userId = await seedUser();
  const [teamId, personal] = await Promise.all([seedTeam(), seedKey({ userId })]);
  const teamKey = await seedKey({ userId, teamId });

  expect((await getApiKeyPrincipal(personal.secret))?.audience).toEqual({ type: "personal" });
  expect((await getApiKeyPrincipal(teamKey.secret))?.audience).toEqual({ type: "team", teamId });

  // Second resolution comes from the snapshot written by the first.
  expect(await readSnapshot(teamKey.hash)).not.toBeNull();
  expect((await getApiKeyPrincipal(teamKey.secret))?.audience).toEqual({ type: "team", teamId });
});

// The write paths refuse this combination now, but a key issued before they did still holds the
// row. The principal is where that grant would take effect, so it is narrowed there too — and
// through the snapshot, or the first cache hit would hand the dead scopes back.
test.skipIf(!ACCOUNT_ONLY_SCOPE)(
  "a team key issued with account-only scopes resolves without them",
  async () => {
    const userId = await seedUser();
    const teamId = await seedTeam();
    const legacy = await seedKey({
      userId,
      teamId,
      scopes: [TEAM_SCOPE, ACCOUNT_ONLY_SCOPE!],
    });

    expect((await getApiKeyPrincipal(legacy.secret))?.scopes).toEqual([TEAM_SCOPE]);

    expect(await readSnapshot(legacy.hash)).not.toBeNull();
    expect((await getApiKeyPrincipal(legacy.secret))?.scopes).toEqual([TEAM_SCOPE]);

    // The same grant on a personal key is untouched, so this narrows by audience, not by scope.
    const personal = await seedKey({ userId, scopes: [TEAM_SCOPE, ACCOUNT_ONLY_SCOPE!] });
    expect((await getApiKeyPrincipal(personal.secret))?.scopes).toEqual([
      TEAM_SCOPE,
      ACCOUNT_ONLY_SCOPE!,
    ]);
  },
);

test("a cache hit serves the principal without reading D1", async () => {
  const userId = await seedUser();
  const key = await seedKey({ userId });

  await getApiKeyPrincipal(key.secret);

  // Deleting the row proves the second resolution came from the snapshot alone.
  await db.delete(apiKeyTable).where(eq(apiKeyTable.id, key.id));

  const principal = await getApiKeyPrincipal(key.secret);
  expect(principal).toMatchObject({ kind: "api-key", keyId: key.id });
});

test("a snapshot from an older cache version is ignored and rebuilt", async () => {
  const userId = await seedUser();
  const key = await seedKey({ userId });

  await env.KV_STORE.put(
    `apikey:${key.hash}`,
    JSON.stringify({
      version: CURRENT_API_KEY_CACHE_VERSION - 1,
      keyId: "akey_stale",
      userId: "usr_stale",
      teamId: null,
      scopes: ["stale:scope"],
      user: { id: "usr_stale" },
      teams: [],
      expiresAt: null,
      lastUsedAt: null,
    }),
    { expirationTtl: API_KEY_CACHE_TTL_SECONDS },
  );

  const principal = await getApiKeyPrincipal(key.secret);

  expect(principal).toMatchObject({ kind: "api-key", keyId: key.id });
  expect(principal?.userId).toBe(userId);
  expect(principal?.scopes).toEqual([SCOPE]);
});

test("revoking a key kills access immediately by deleting the snapshot", async () => {
  const userId = await seedUser();
  authState.current = sessionFor(userId);
  const created = await createApiKey({ name: "resolver", scopes: [SCOPE] });

  expect(await getApiKeyPrincipal(created.secret)).not.toBeNull();
  const keyHash = await hashToken(created.secret);
  expect(await readSnapshot(keyHash)).not.toBeNull();

  await revokeApiKey({ keyId: created.key.id });

  expect(await readSnapshot(keyHash)).toBeNull();
  expect(await getApiKeyPrincipal(created.secret)).toBeNull();
});

// The snapshot embeds the granted scopes, so a narrowed key that kept its cached principal would
// keep its old power for the rest of the TTL.
test("re-scoping a key drops its snapshot so the new grant applies at once", async () => {
  const userId = await seedUser();
  authState.current = sessionFor(userId);
  const created = await createApiKey({ name: "resolver", scopes: [...API_SCOPE_NAMES] });

  expect((await getApiKeyPrincipal(created.secret))?.scopes).toEqual([...API_SCOPE_NAMES]);
  const keyHash = await hashToken(created.secret);
  expect(await readSnapshot(keyHash)).not.toBeNull();

  await updateApiKeyScopes({ keyId: created.key.id, scopes: [SCOPE] });

  expect(await readSnapshot(keyHash)).toBeNull();
  expect((await getApiKeyPrincipal(created.secret))?.scopes).toEqual([SCOPE]);
});

test("an expired key is rejected even though its row still exists", async () => {
  const userId = await seedUser();
  const key = await seedKey({ userId, expiresAt: new Date(Date.now() - 60_000) });

  expect(await getApiKeyPrincipal(key.secret)).toBeNull();
  expect(await readSnapshot(key.hash)).toBeNull();
});

// A snapshot carrying a past expiry is discarded rather than answered from: D1 decides, and here
// it still says the key is live, so the resolver rebuilds instead of failing.
test("an expired snapshot is discarded and rebuilt from D1", async () => {
  const userId = await seedUser();
  const expiresAt = new Date(Date.now() + 60_000);
  const key = await seedKey({ userId, expiresAt });

  await getApiKeyPrincipal(key.secret);
  const snapshot = JSON.parse((await readSnapshot(key.hash))!);

  await env.KV_STORE.put(
    `apikey:${key.hash}`,
    JSON.stringify({ ...snapshot, expiresAt: Date.now() - 1, keyId: "akey_stale" }),
    { expirationTtl: API_KEY_CACHE_TTL_SECONDS },
  );

  const principal = await getApiKeyPrincipal(key.secret);

  expect(principal).toMatchObject({ kind: "api-key", keyId: key.id });
  // D1 stores timestamp columns in whole seconds, so the rebuilt stamp is the truncated one.
  expect(JSON.parse((await readSnapshot(key.hash))!).expiresAt)
    .toBe(Math.floor(expiresAt.getTime() / 1000) * 1000);
});

test("a key whose row was revoked directly stops working once the snapshot is dropped", async () => {
  const userId = await seedUser();
  const key = await seedKey({ userId });

  await getApiKeyPrincipal(key.secret);
  await db.update(apiKeyTable).set({ revokedAt: new Date() }).where(eq(apiKeyTable.id, key.id));

  // The stale snapshot still answers until it is deleted — the documented ≤TTL acceptance window.
  expect(await getApiKeyPrincipal(key.secret)).not.toBeNull();

  await deleteApiKeyCache({ keyHash: key.hash });

  expect(await getApiKeyPrincipal(key.secret)).toBeNull();
});

test("purging a user's cache drops every one of their snapshots", async () => {
  const userId = await seedUser();
  const [first, second] = await Promise.all([seedKey({ userId }), seedKey({ userId })]);

  await getApiKeyPrincipal(first.secret);
  await getApiKeyPrincipal(second.secret);

  expect(await readSnapshot(first.hash)).not.toBeNull();
  expect(await readSnapshot(second.hash)).not.toBeNull();

  await purgeUserPrincipalCaches(userId);

  expect(await readSnapshot(first.hash)).toBeNull();
  expect(await readSnapshot(second.hash)).toBeNull();
  // The keys themselves are untouched: only the cache was dropped.
  expect(await getApiKeyPrincipal(first.secret)).not.toBeNull();
});

test("the last-used stamp is recorded for a freshly resolved key", async () => {
  const userId = await seedUser();
  const key = await seedKey({ userId });

  await getApiKeyPrincipal(key.secret);

  const stored = await db.query.apiKeyTable.findFirst({ where: { id: key.id } });
  expect(stored?.lastUsedAt).toBeInstanceOf(Date);
});
