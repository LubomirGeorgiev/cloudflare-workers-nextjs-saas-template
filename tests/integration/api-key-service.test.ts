/// <reference types="@cloudflare/vitest-plugin/types" />

// Behavior coverage for the API-key service against a real D1: the creation cap is enforced by a
// conditional INSERT (D1 has no transactions), scopes are validated against the shared catalog,
// creation self-authenticates, and revocation is scoped so one user can never touch another's key.
//
// Mocking mirrors team-rename.test.ts: request-scoped identity is injected because
// requireVerifiedEmail reads next/headers cookies that don't exist in the Workers test pool. The
// stub reproduces its two refusals so the service's own guard is under test, not assumed away.

import { beforeEach, expect, test, vi } from "vitest";

const { authState } = vi.hoisted(() => ({ authState: { current: null as unknown } }));

vi.mock("@/utils/auth", async (importOriginal) => {
  const { ActionError } = await import("@/lib/action-error");

  return {
    ...(await importOriginal<typeof import("@/utils/auth")>()),
    requireVerifiedEmail: async () => {
      const session = authState.current as { user?: { emailVerified?: Date | null } } | null;

      if (!session) {
        throw new ActionError("NOT_AUTHORIZED", { key: "Client.Errors.notAuthenticated" });
      }

      if (!session.user?.emailVerified) {
        throw new ActionError("FORBIDDEN", { key: "Client.Errors.emailVerificationRequired" });
      }

      return session;
    },
    getCurrentSession: async () => authState.current,
  };
});

import { MAX_API_KEYS_PER_TEAM, MAX_API_KEYS_PER_USER } from "@/constants";
import { getDB } from "@/db";
import {
  SYSTEM_ROLES_ENUM,
  apiKeyTable,
  teamMembershipTable,
  teamTable,
  userTable,
} from "@/db/schema";
import {
  createApiKey,
  listTeamApiKeys,
  listUserApiKeys,
  revokeApiKey,
  updateApiKeyScopes,
} from "@/lib/api-keys/api-keys";
import { runWithPrincipal, type ApiKeyPrincipal } from "@/lib/api/principal";
import {
  API_SCOPE_NAMES,
  TEAM_KEY_SCOPES,
  isAccountOnlyScope,
  type ApiScope,
} from "@/lib/api/scopes";
import { looksLikeApiKey } from "@/utils/api-key-format";

const db = getDB();
const SCOPE = API_SCOPE_NAMES[0];
// A fork can shrink the catalog; escalation is only expressible with a second scope to ask for.
const OTHER_SCOPE = API_SCOPE_NAMES.find((scope) => scope !== SCOPE);
// Every team-key test grants this instead of SCOPE: an account-only scope is refused on a team
// key, and these tests are about caps, permissions, and listings rather than about that rule.
const TEAM_SCOPE = TEAM_KEY_SCOPES[0];
// The rule's own subject. Undefined in a fork whose catalog has no account-only scope left.
const ACCOUNT_ONLY_SCOPE = API_SCOPE_NAMES.find(isAccountOnlyScope);

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

function buildKeyPrincipal({
  userId,
  scopes,
  audience = { type: "personal" },
}: {
  userId: string;
  scopes: ApiScope[];
  audience?: ApiKeyPrincipal["audience"];
}): ApiKeyPrincipal {
  return {
    kind: "api-key",
    userId,
    user: { id: userId } as ApiKeyPrincipal["user"],
    teams: [],
    scopes,
    audience,
    keyId: uid("akey"),
  };
}

function sessionFor(userId: string) {
  return {
    id: `sess_${userId}`,
    userId,
    user: { id: userId, email: `${userId}@example.com`, emailVerified: new Date() },
  } as unknown;
}

function unverifiedSessionFor(userId: string) {
  return {
    id: `sess_${userId}`,
    userId,
    user: { id: userId, email: `${userId}@example.com`, emailVerified: null },
  } as unknown;
}

async function seedUser(): Promise<string> {
  const userId = uid("usr");
  await db.insert(userTable).values({ id: userId, email: `${userId}@example.com`, emailVerified: new Date() });
  return userId;
}

// A team whose owner holds MANAGE_API_KEYS through the system owner role, plus a plain member who
// does not, so the permission gate is exercised against two real memberships.
async function seedTeam() {
  const [ownerId, memberId] = await Promise.all([seedUser(), seedUser()]);
  const teamId = uid("team");

  await db.insert(teamTable).values({ id: teamId, name: "Keys Team", slug: uid("slug") });
  await db.insert(teamMembershipTable).values([
    {
      id: uid("tmem"),
      teamId,
      userId: ownerId,
      roleId: SYSTEM_ROLES_ENUM.OWNER,
      isSystemRole: 1,
      joinedAt: new Date(),
      isActive: 1,
    },
    {
      id: uid("tmem"),
      teamId,
      userId: memberId,
      roleId: SYSTEM_ROLES_ENUM.MEMBER,
      isSystemRole: 1,
      joinedAt: new Date(),
      isActive: 1,
    },
  ]);

  return { teamId, ownerId, memberId };
}

beforeEach(() => {
  authState.current = null;
});

test("a created key returns a usable secret once and stores only its hash", async () => {
  const userId = await seedUser();
  authState.current = sessionFor(userId);

  const created = await createApiKey({ name: "CI", scopes: [SCOPE] });

  expect(looksLikeApiKey(created.secret)).toBe(true);
  expect(created.key.scopes).toEqual([SCOPE]);

  const stored = await db.query.apiKeyTable.findFirst({ where: { id: created.key.id } });
  expect(stored?.keyHash).toBeTruthy();
  expect(stored?.keyHash).not.toBe(created.secret);
  expect(JSON.stringify(stored)).not.toContain(created.secret);
  expect(created.secret.endsWith(stored?.last4 ?? "")).toBe(true);
});

test("duplicate scopes are collapsed and unknown scopes are rejected", async () => {
  const userId = await seedUser();
  authState.current = sessionFor(userId);

  const created = await createApiKey({ name: "CI", scopes: [SCOPE, SCOPE] });
  expect(created.key.scopes).toEqual([SCOPE]);

  await expect(createApiKey({ name: "CI", scopes: ["nope:write"] })).rejects.toMatchObject({
    code: "INPUT_PARSE_ERROR",
  });
  await expect(createApiKey({ name: "CI", scopes: [] })).rejects.toMatchObject({
    code: "INPUT_PARSE_ERROR",
  });
});

test("the per-user cap is enforced and a revoked key frees its slot", async () => {
  const userId = await seedUser();
  authState.current = sessionFor(userId);

  const created = [];
  for (let i = 0; i < MAX_API_KEYS_PER_USER; i++) {
    created.push(await createApiKey({ name: `key-${i}`, scopes: [SCOPE] }));
  }

  await expect(createApiKey({ name: "one too many", scopes: [SCOPE] })).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });

  await revokeApiKey({ keyId: created[0].key.id });

  await expect(createApiKey({ name: "reuses the slot", scopes: [SCOPE] })).resolves.toMatchObject({
    key: { name: "reuses the slot" },
  });
});

test("an expired key does not hold a capacity slot", async () => {
  const userId = await seedUser();
  authState.current = sessionFor(userId);
  const expired = new Date(Date.now() - 60_000);

  for (let i = 0; i < MAX_API_KEYS_PER_USER; i++) {
    await createApiKey({ name: `stale-${i}`, scopes: [SCOPE], expiresAt: expired });
  }

  await expect(createApiKey({ name: "still allowed", scopes: [SCOPE] })).resolves.toBeTruthy();
});

test("team keys are capped separately from the creator's personal keys", async () => {
  const { teamId, ownerId } = await seedTeam();
  authState.current = sessionFor(ownerId);

  for (let i = 0; i < MAX_API_KEYS_PER_TEAM; i++) {
    await createApiKey({ teamId, name: `team-${i}`, scopes: [TEAM_SCOPE] });
  }

  await expect(
    createApiKey({ teamId, name: "over cap", scopes: [TEAM_SCOPE] }),
  ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

  // The personal bucket is untouched by the team's usage.
  await expect(createApiKey({ name: "personal", scopes: [SCOPE] })).resolves.toBeTruthy();
});

test("a member without MANAGE_API_KEYS can neither create nor list team keys", async () => {
  const { teamId, ownerId, memberId } = await seedTeam();

  authState.current = sessionFor(ownerId);
  const ownerKey = await createApiKey({ teamId, name: "owned", scopes: [TEAM_SCOPE] });

  authState.current = sessionFor(memberId);
  await expect(createApiKey({ teamId, name: "sneaky", scopes: [TEAM_SCOPE] }))
    .rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(listTeamApiKeys({ teamId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(revokeApiKey({ keyId: ownerKey.key.id })).rejects.toMatchObject({ code: "FORBIDDEN" });

  const stored = await db.query.apiKeyTable.findFirst({ where: { id: ownerKey.key.id } });
  expect(stored?.revokedAt).toBeNull();
});

test("listings are scoped: personal keys exclude team keys and vice versa", async () => {
  const { teamId, ownerId } = await seedTeam();
  authState.current = sessionFor(ownerId);

  const personal = await createApiKey({ name: "personal", scopes: [SCOPE] });
  const team = await createApiKey({ teamId, name: "team", scopes: [TEAM_SCOPE] });

  const [personalKeys, teamKeys] = await Promise.all([listUserApiKeys(), listTeamApiKeys({ teamId })]);

  expect(personalKeys.map((key) => key.id)).toContain(personal.key.id);
  expect(personalKeys.map((key) => key.id)).not.toContain(team.key.id);
  expect(teamKeys.map((key) => key.id)).toEqual([team.key.id]);
});

test("another user's key can neither be revoked nor listed", async () => {
  const [ownerId, strangerId] = await Promise.all([seedUser(), seedUser()]);

  authState.current = sessionFor(ownerId);
  const created = await createApiKey({ name: "mine", scopes: [SCOPE] });

  authState.current = sessionFor(strangerId);
  await expect(revokeApiKey({ keyId: created.key.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await listUserApiKeys()).toEqual([]);

  const stored = await db.query.apiKeyTable.findFirst({ where: { id: created.key.id } });
  expect(stored?.revokedAt).toBeNull();
});

test("revocation stamps the row, hides it from listings, and is idempotent", async () => {
  const userId = await seedUser();
  authState.current = sessionFor(userId);

  const created = await createApiKey({ name: "CI", scopes: [SCOPE] });
  await revokeApiKey({ keyId: created.key.id });

  const revoked = await db.query.apiKeyTable.findFirst({ where: { id: created.key.id } });
  expect(revoked?.revokedAt).toBeInstanceOf(Date);
  expect(await listUserApiKeys()).toEqual([]);

  await expect(revokeApiKey({ keyId: created.key.id })).resolves.toEqual({ success: true });

  const stillRevoked = await db.query.apiKeyTable.findFirst({ where: { id: created.key.id } });
  expect(stillRevoked?.revokedAt?.getTime()).toBe(revoked?.revokedAt?.getTime());
});

// Creation policy is the service's, not the transport's: an unauthenticated or unverified caller
// is refused here, so no future write path can mint a key by skipping a route-level check.
test("creation is refused without a verified session, whatever the caller", async () => {
  const userId = await seedUser();

  await expect(createApiKey({ name: "anonymous", scopes: [SCOPE] })).rejects.toMatchObject({
    code: "NOT_AUTHORIZED",
  });

  authState.current = unverifiedSessionFor(userId);
  await expect(createApiKey({ name: "unverified", scopes: [SCOPE] })).rejects.toMatchObject({
    code: "FORBIDDEN",
  });

  expect(await db.query.apiKeyTable.findMany({ where: { userId } })).toEqual([]);
});

// No privilege escalation: a bearer credential can only ever mint a subset of itself, while a
// cookie session (no ALS principal) may still grant the whole catalog.
test.skipIf(!OTHER_SCOPE)("a scoped credential cannot mint scopes it does not hold", async () => {
  const userId = await seedUser();
  authState.current = sessionFor(userId);
  const principal = buildKeyPrincipal({ userId, scopes: [SCOPE] });

  await expect(
    runWithPrincipal(principal, () => createApiKey({ name: "escalated", scopes: [OTHER_SCOPE!] })),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });

  await expect(
    runWithPrincipal(principal, () => createApiKey({ name: "subset", scopes: [SCOPE] })),
  ).resolves.toBeTruthy();

  await expect(createApiKey({ name: "cookie", scopes: [OTHER_SCOPE!] })).resolves.toBeTruthy();

  const names = (await db.query.apiKeyTable.findMany({ where: { userId } })).map((key) => key.name);
  expect(names).not.toContain("escalated");
});

// A team key is refused every account-level operation whatever its scopes, so granting it one is
// writing a permission no request can exercise. Refused at both write paths, not filtered away:
// silently dropping a requested scope would hand back a key weaker than the caller asked for.
test.skipIf(!ACCOUNT_ONLY_SCOPE)("a team key cannot be minted with an account-only scope", async () => {
  const { teamId, ownerId } = await seedTeam();
  authState.current = sessionFor(ownerId);

  await expect(
    createApiKey({ teamId, name: "over-granted", scopes: [TEAM_SCOPE, ACCOUNT_ONLY_SCOPE!] }),
  ).rejects.toMatchObject({ code: "INPUT_PARSE_ERROR" });

  // Nothing was written: the refusal precedes the INSERT, not just the response.
  const rows = await db.query.apiKeyTable.findMany({ where: { teamId } });
  expect(rows).toEqual([]);

  // The same scope on a personal key is exactly what it is for.
  await expect(
    createApiKey({ name: "personal", scopes: [ACCOUNT_ONLY_SCOPE!] }),
  ).resolves.toMatchObject({ key: { scopes: [ACCOUNT_ONLY_SCOPE!], teamId: null } });
});

test.skipIf(!ACCOUNT_ONLY_SCOPE)("a team key cannot be re-scoped into an account-only scope", async () => {
  const { teamId, ownerId } = await seedTeam();
  authState.current = sessionFor(ownerId);

  const created = await createApiKey({ teamId, name: "team", scopes: [TEAM_SCOPE] });

  await expect(
    updateApiKeyScopes({ keyId: created.key.id, scopes: [ACCOUNT_ONLY_SCOPE!] }),
  ).rejects.toMatchObject({ code: "INPUT_PARSE_ERROR" });

  const stored = await db.query.apiKeyTable.findFirst({ where: { id: created.key.id } });
  expect(stored?.scopes).toEqual([TEAM_SCOPE]);
});

// A key written before the rule existed still carries the scope in D1. Every read path narrows it
// away, so the settings page, the REST listing, and the principal resolver agree on the grant.
test.skipIf(!ACCOUNT_ONLY_SCOPE)("a legacy team key lists without its account-only scope", async () => {
  const { teamId, ownerId } = await seedTeam();
  authState.current = sessionFor(ownerId);
  const keyId = uid("akey");
  const storedScopes = [TEAM_SCOPE, ACCOUNT_ONLY_SCOPE!];

  await db.insert(apiKeyTable).values({
    id: keyId,
    userId: ownerId,
    teamId,
    name: "legacy",
    keyHash: uid("hash"),
    keyPrefix: "prefix",
    last4: "0000",
    scopes: storedScopes,
  });

  const listed = await listTeamApiKeys({ teamId });
  expect(listed.map((key) => key.id)).toEqual([keyId]);
  expect(listed[0].scopes).toEqual([TEAM_SCOPE]);

  // The read narrows; the row is left alone, so nothing needs a migration.
  const stored = await db.query.apiKeyTable.findFirst({ where: { id: keyId } });
  expect(stored?.scopes).toEqual(storedScopes);
});

// Minting is account-level, and the service says so itself rather than trusting the route: a team
// key that reached this far could otherwise widen its own audience one generation at a time.
test("a team-scoped credential cannot mint a key at all", async () => {
  const { teamId, ownerId } = await seedTeam();
  authState.current = sessionFor(ownerId);
  // Every scope granted, so the refusal below can only come from the audience, not the scope check.
  const principal = buildKeyPrincipal({
    userId: ownerId,
    scopes: [...API_SCOPE_NAMES],
    audience: { type: "team", teamId },
  });

  for (const params of [{ name: "own team", teamId }, { name: "personal" }]) {
    await expect(
      runWithPrincipal(principal, () => createApiKey({ ...params, scopes: [SCOPE] })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  }

  expect(await db.query.apiKeyTable.findMany({ where: { userId: ownerId } })).toEqual([]);
});

// ---------------------------------------------------------------------------
// Re-scoping an existing key. The secret is untouched, so every guard that governs minting one
// governs this too — a key whose scopes can be widened is a key that can be escalated.
// ---------------------------------------------------------------------------

test("scopes are replaced wholesale, not merged, and the stored row agrees", async () => {
  const userId = await seedUser();
  authState.current = sessionFor(userId);

  const created = await createApiKey({ name: "CI", scopes: [...API_SCOPE_NAMES] });
  const updated = await updateApiKeyScopes({ keyId: created.key.id, scopes: [SCOPE, SCOPE] });

  // Duplicates collapse on this path exactly as they do on creation.
  expect(updated.scopes).toEqual([SCOPE]);
  expect(updated.id).toBe(created.key.id);
  expect(updated.name).toBe(created.key.name);

  const stored = await db.query.apiKeyTable.findFirst({ where: { id: created.key.id } });
  expect(stored?.scopes).toEqual([SCOPE]);
  // Nothing but the grant moves: the secret's hash and the key's identity are left alone.
  expect(stored?.keyHash).toBeTruthy();
  expect(stored?.name).toBe("CI");
});

test("an empty or unknown scope set is refused before anything is written", async () => {
  const userId = await seedUser();
  authState.current = sessionFor(userId);
  const created = await createApiKey({ name: "CI", scopes: [SCOPE] });

  for (const scopes of [[], ["nope:write"]]) {
    await expect(updateApiKeyScopes({ keyId: created.key.id, scopes })).rejects.toMatchObject({
      code: "INPUT_PARSE_ERROR",
    });
  }

  const stored = await db.query.apiKeyTable.findFirst({ where: { id: created.key.id } });
  expect(stored?.scopes).toEqual([SCOPE]);
});

// Missing, foreign, and revoked all answer the same way, so a caller learns nothing about which
// key ids exist — and a revoked row stays as unactionable as it is invisible.
test("a nonexistent, foreign, or revoked key is not found", async () => {
  const [ownerId, strangerId] = await Promise.all([seedUser(), seedUser()]);

  authState.current = sessionFor(ownerId);
  const created = await createApiKey({ name: "mine", scopes: [SCOPE] });
  const revoked = await createApiKey({ name: "gone", scopes: [SCOPE] });
  await revokeApiKey({ keyId: revoked.key.id });

  await expect(
    updateApiKeyScopes({ keyId: uid("akey"), scopes: [SCOPE] }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    updateApiKeyScopes({ keyId: revoked.key.id, scopes: [SCOPE] }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });

  authState.current = sessionFor(strangerId);
  await expect(
    updateApiKeyScopes({ keyId: created.key.id, scopes: [SCOPE] }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

test("a team key is re-scoped only by a member holding MANAGE_API_KEYS", async () => {
  const { teamId, ownerId, memberId } = await seedTeam();

  authState.current = sessionFor(ownerId);
  // Every scope a team key may hold, so the refusal below is about the permission, not the grant.
  const created = await createApiKey({ teamId, name: "owned", scopes: [...TEAM_KEY_SCOPES] });

  authState.current = sessionFor(memberId);
  await expect(
    updateApiKeyScopes({ keyId: created.key.id, scopes: [TEAM_SCOPE] }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });

  const untouched = await db.query.apiKeyTable.findFirst({ where: { id: created.key.id } });
  expect(untouched?.scopes).toEqual([...TEAM_KEY_SCOPES]);

  authState.current = sessionFor(ownerId);
  await expect(updateApiKeyScopes({ keyId: created.key.id, scopes: [TEAM_SCOPE] })).resolves
    .toMatchObject({ scopes: [TEAM_SCOPE] });
});

test("re-scoping is refused without a verified session", async () => {
  const userId = await seedUser();
  authState.current = sessionFor(userId);
  const created = await createApiKey({ name: "CI", scopes: [SCOPE] });

  authState.current = null;
  await expect(
    updateApiKeyScopes({ keyId: created.key.id, scopes: [SCOPE] }),
  ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });

  authState.current = unverifiedSessionFor(userId);
  await expect(
    updateApiKeyScopes({ keyId: created.key.id, scopes: [SCOPE] }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
});

// Same escalation ceiling as creation: a bearer credential can only ever leave a key a subset of
// itself, while a cookie session (no ALS principal) may still grant the whole catalog.
test.skipIf(!OTHER_SCOPE)("a scoped credential cannot widen a key past its own grant", async () => {
  const userId = await seedUser();
  authState.current = sessionFor(userId);
  const created = await createApiKey({ name: "CI", scopes: [SCOPE] });
  const principal = buildKeyPrincipal({ userId, scopes: [SCOPE] });

  await expect(
    runWithPrincipal(principal, () =>
      updateApiKeyScopes({ keyId: created.key.id, scopes: [OTHER_SCOPE!] }),
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });

  await expect(
    runWithPrincipal(principal, () => updateApiKeyScopes({ keyId: created.key.id, scopes: [SCOPE] })),
  ).resolves.toMatchObject({ scopes: [SCOPE] });

  await expect(
    updateApiKeyScopes({ keyId: created.key.id, scopes: [OTHER_SCOPE!] }),
  ).resolves.toMatchObject({ scopes: [OTHER_SCOPE!] });
});

// Re-scoping is account-level for the same reason minting is: a team credential that could edit a
// key would otherwise widen its own audience one generation at a time.
test("a team-scoped credential cannot re-scope any key", async () => {
  const { teamId, ownerId } = await seedTeam();
  authState.current = sessionFor(ownerId);

  const personal = await createApiKey({ name: "personal", scopes: [SCOPE] });
  const teamKey = await createApiKey({ teamId, name: "team", scopes: [TEAM_SCOPE] });
  // Every scope granted, so the refusals below can only come from the audience.
  const principal = buildKeyPrincipal({
    userId: ownerId,
    scopes: [...API_SCOPE_NAMES],
    audience: { type: "team", teamId },
  });

  for (const keyId of [personal.key.id, teamKey.key.id]) {
    await expect(
      runWithPrincipal(principal, () => updateApiKeyScopes({ keyId, scopes: [...API_SCOPE_NAMES] })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
});

test("the key hash is unique across the table", async () => {
  const userId = await seedUser();
  authState.current = sessionFor(userId);
  const created = await createApiKey({ name: "CI", scopes: [SCOPE] });
  const stored = await db.query.apiKeyTable.findFirst({ where: { id: created.key.id } });

  await expect(
    db.insert(apiKeyTable).values({
      id: uid("akey"),
      userId,
      name: "clone",
      keyHash: stored!.keyHash,
      keyPrefix: stored!.keyPrefix,
      last4: stored!.last4,
      scopes: [SCOPE],
    }),
  ).rejects.toThrow();
});
