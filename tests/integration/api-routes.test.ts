/// <reference types="@cloudflare/vitest-plugin/types" />

// End-to-end coverage of the public REST API against real D1 + KV: requests carry a real API key,
// so nothing about authentication or authorization is mocked. What is under test is the full
// chain — bearer resolution, the ALS principal bridge into the existing service layer, per-scope
// guards, D1-authoritative team permissions, and problem+json error mapping.
//
// Assertions derive from the app's own constants (base path, scope catalog, permissions) so a
// fork that rebrands or moves the API keeps them valid.

import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { createExecutionContext } from "cloudflare:test";
import { expect, test } from "vitest";

import { apiApp } from "@/api";
import {
  API_V1_BASE_PATH,
  MAX_TEAMS_CREATED_PER_USER,
  NAME_MIN_LENGTH,
  OAUTH_PROTECTED_RESOURCE_PATH,
} from "@/constants";
import { DEFAULT_PLAN_ID, TEAM_PLANS, TEAM_PLAN_IDS, type TeamPlanId } from "@/constants/plans";
import { getDB } from "@/db";
import {
  SYSTEM_ROLES_ENUM,
  apiKeyTable,
  teamMembershipTable,
  teamTable,
  userTable,
} from "@/db/schema";
import {
  API_SCOPE_NAMES,
  TEAM_KEY_SCOPES,
  isAccountOnlyScope,
  type ApiScope,
} from "@/lib/api/scopes";
import { PROBLEM_BY_CODE, PROBLEM_JSON_CONTENT_TYPE } from "@/lib/api/errors";
import { FIELD_ERROR_CODES } from "@/lib/api/field-errors";
import { generateApiKey } from "@/utils/api-key-format";

const db = getDB();
const ORIGIN = "https://example.com";

// Derived, never hard-coded: a fork edits plans.json freely, but an invite can only succeed on a
// plan whose seat limit leaves room beyond the owner's own membership. Undefined in a fork that
// sells no multi-seat plan, which skips the tests that need one.
const MULTI_SEAT_PLAN_ID = TEAM_PLAN_IDS.find((id) => TEAM_PLANS[id].limits.seats > 1);

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

interface CallOptions {
  method?: string;
  secret?: string;
  body?: unknown;
  /** Bytes sent verbatim under a JSON content type — the only way to send a body that is not JSON. */
  rawBody?: string;
}

async function call(path: string, { method = "GET", secret, body, rawBody }: CallOptions = {}) {
  const declaresJson = body !== undefined || rawBody !== undefined;
  const response = await apiApp.fetch(
    new Request(`${ORIGIN}${API_V1_BASE_PATH}${path}`, {
      method,
      headers: {
        ...(secret ? { authorization: `Bearer ${secret}` } : {}),
        ...(declaresJson ? { "content-type": "application/json" } : {}),
      },
      body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
    }),
    env as Env,
    createExecutionContext(),
  );

  return { response, body: await response.json() as Record<string, unknown> };
}

async function seedUser({ updatedAt }: { updatedAt?: Date } = {}): Promise<{
  id: string;
  email: string;
}> {
  const id = uid("usr");
  const email = `${id}@example.com`;

  await db.insert(userTable).values({
    id,
    email,
    firstName: "Api",
    lastName: "Caller",
    emailVerified: new Date(),
    // Explicit timestamps let a test tell a pre-write snapshot apart from the committed row.
    ...(updatedAt ? { createdAt: updatedAt, updatedAt } : {}),
  });

  return { id, email };
}

// Written straight to D1 so a test can hand out any scope set without going through the
// settings action's own authorization. `teamId` is the key's audience: null is a personal key.
async function seedKey({
  userId,
  scopes,
  teamId,
}: {
  userId: string;
  scopes: ApiScope[];
  teamId?: string;
}): Promise<string> {
  const generated = await generateApiKey();

  await db.insert(apiKeyTable).values({
    id: uid("akey"),
    userId,
    name: "integration",
    keyHash: generated.hash,
    keyPrefix: generated.prefix,
    last4: generated.last4,
    scopes,
    teamId,
  });

  return generated.secret;
}

async function seedTeam({
  userId,
  roleId = SYSTEM_ROLES_ENUM.OWNER,
  planId,
}: {
  userId: string;
  roleId?: string;
  // Omitted leaves the team on the default plan's entitlements; naming one also marks the
  // subscription active, since entitlements fall back to the default plan otherwise.
  planId?: TeamPlanId;
}): Promise<string> {
  const teamId = uid("team");

  await db.insert(teamTable).values({
    id: teamId,
    name: "Api Team",
    slug: uid("api-team"),
    subscriptionPlanId: planId,
    subscriptionStatus: planId ? "active" : undefined,
  });
  await db.insert(teamMembershipTable).values({
    id: uid("tmem"),
    teamId,
    userId,
    roleId,
    isSystemRole: 1,
    invitedBy: userId,
    joinedAt: new Date(),
    isActive: 1,
  });

  return teamId;
}

async function seedMembership({
  teamId,
  userId,
  roleId,
}: {
  teamId: string;
  userId: string;
  roleId: string;
}): Promise<void> {
  await db.insert(teamMembershipTable).values({
    id: uid("tmem"),
    teamId,
    userId,
    roleId,
    isSystemRole: 1,
    invitedBy: userId,
    joinedAt: new Date(),
    isActive: 1,
  });
}

test("a request with no credential is rejected with a problem document", async () => {
  const { response, body } = await call("/me");

  expect(response.status).toBe(401);
  expect(response.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);
  // RFC 9728 discovery pointer: this is what turns a bare 401 into an auto-triggered OAuth flow.
  expect(response.headers.get("www-authenticate")).toContain(
    `resource_metadata="${ORIGIN}${OAUTH_PROTECTED_RESOURCE_PATH}${API_V1_BASE_PATH}/me"`,
  );
  expect(body.code).toBe("NOT_AUTHORIZED");
});

test("a malformed bearer token never resolves", async () => {
  const { response, body } = await call("/me", { secret: "not-an-api-key" });

  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toContain("invalid_token");
  expect(body.code).toBe("NOT_AUTHORIZED");
});

test("a well-formed but unknown key is rejected", async () => {
  const { secret } = await generateApiKey();

  expect((await call("/me", { secret })).response.status).toBe(401);
});

test("a valid key without the operation's scope is forbidden", async () => {
  const user = await seedUser();
  const secret = await seedKey({ userId: user.id, scopes: ["teams:read"] });

  const { response, body } = await call("/me", { secret });

  expect(response.status).toBe(403);
  expect(body.code).toBe("FORBIDDEN");
});

test("a valid key with the right scope reads the account", async () => {
  const user = await seedUser();
  const secret = await seedKey({ userId: user.id, scopes: ["profile:read"] });

  const { response, body } = await call("/me", { secret });

  expect(response.status).toBe(200);
  expect(body).toMatchObject({ id: user.id, email: user.email });
  // The response is a projection, never the raw session snapshot.
  expect(body).not.toHaveProperty("teams");
});

// Authentication runs ahead of routing, so an anonymous caller cannot enumerate which paths
// exist; only an authenticated request reaches the 404 fallback.
test("an unknown path under the API answers a problem document, not the app", async () => {
  const user = await seedUser();
  const secret = await seedKey({ userId: user.id, scopes: ["profile:read"] });

  const anonymous = await call("/definitely-not-a-resource");
  expect(anonymous.response.status).toBe(401);

  const { response, body } = await call("/definitely-not-a-resource", { secret });

  expect(response.status).toBe(404);
  expect(response.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);
  expect(body.code).toBe("NOT_FOUND");
});

// Machine clients branch on the stable code, never on localized copy: every entry locates the
// rejected value (RFC 6901 pointer + OpenAPI location) and names the constraint it violated.
test("a rejected body answers 400 with located, coded field errors", async () => {
  const user = await seedUser();
  const secret = await seedKey({ userId: user.id, scopes: ["profile:write"] });

  const { response, body } = await call("/me", {
    method: "PATCH",
    secret,
    body: { firstName: "", lastName: "" },
  });

  expect(response.status).toBe(400);
  expect(body.code).toBe("INPUT_PARSE_ERROR");
  // The limit comes from the app's own constant so a fork that retunes it keeps this valid.
  // Names are trimmed labels, so an empty one trips both the minimum and the visible-character rule.
  expect(body.errors).toEqual([
    { in: "body", pointer: "/firstName", code: "min_length", params: { min: NAME_MIN_LENGTH } },
    { in: "body", pointer: "/firstName", code: "invalid_value" },
    { in: "body", pointer: "/lastName", code: "min_length", params: { min: NAME_MIN_LENGTH } },
    { in: "body", pointer: "/lastName", code: "invalid_value" },
  ]);
});

// Valibot reports an absent key on the *object* schema and a wrong-typed one on the entry; both
// used to collapse into the same "required" code, which told an agent nothing about the fix.
test("an absent field and a wrong-typed one answer different codes", async () => {
  const user = await seedUser();
  const secret = await seedKey({ userId: user.id, scopes: ["profile:write"] });

  const { response, body } = await call("/me", {
    method: "PATCH",
    secret,
    body: { firstName: 42 },
  });

  expect(response.status).toBe(400);
  expect(body.errors).toEqual([
    { in: "body", pointer: "/firstName", code: "invalid_type", params: { expected: "string" } },
    { in: "body", pointer: "/lastName", code: "required" },
  ]);
});

// The location member is what tells a caller which part of the request to fix; a query parameter
// must not be reported as a body pointer.
test("a rejected query parameter is located in the query", async () => {
  const user = await seedUser();
  const secret = await seedKey({ userId: user.id, scopes: ["api-keys:read"] });

  const { response, body } = await call("/api-keys?teamId=", { secret });

  expect(response.status).toBe(400);
  expect((body.errors as { in: string; pointer: string }[])[0]).toMatchObject({
    in: "query",
    pointer: "/teamId",
  });
});

// The vocabulary is a published contract; an entry outside it means a code shipped undocumented.
test("every field-error code comes from the published vocabulary", async () => {
  const user = await seedUser();
  const secret = await seedKey({ userId: user.id, scopes: ["api-keys:write"] });

  const { body } = await call("/api-keys", {
    method: "POST",
    secret,
    body: { name: "", scopes: ["not-a-scope"], expiresInDays: 0 },
  });

  const errors = body.errors as { code: string }[];

  expect(errors.length).toBeGreaterThan(0);
  for (const error of errors) {
    expect(FIELD_ERROR_CODES).toContain(error.code);
  }
});

// Hono throws before the validation hook can run, so an unparseable body used to reach the
// unmapped-error branch and answer 500 — a caller mistake reported as a server fault.
test.each([
  ["malformed", "{ not json"],
  ["empty", ""],
])("a %s JSON body answers 400, not 500", async (_label, rawBody) => {
  const user = await seedUser();
  const secret = await seedKey({ userId: user.id, scopes: ["profile:write"] });

  const { response, body } = await call("/me", { method: "PATCH", secret, rawBody });

  expect(response.status).toBe(PROBLEM_BY_CODE.INPUT_PARSE_ERROR.status);
  expect(response.headers.get("content-type")).toBe(PROBLEM_JSON_CONTENT_TYPE);
  expect(body.code).toBe("INPUT_PARSE_ERROR");
});

// The response has to come from the committed row, not from the pre-write principal snapshot with
// the accepted input layered back over it: seeding a stale updatedAt makes the two tell apart.
test("the profile can be updated and read back", async () => {
  const staleTimestamp = new Date("2020-01-01T00:00:00Z");
  const user = await seedUser({ updatedAt: staleTimestamp });
  const secret = await seedKey({ userId: user.id, scopes: ["profile:write", "profile:read"] });

  const updated = await call("/me", {
    method: "PATCH",
    secret,
    body: { firstName: "Ada", lastName: "Lovelace" },
  });

  const committed = await db.query.userTable.findFirst({ where: { id: user.id } });

  expect(updated.response.status).toBe(200);
  expect(updated.body).toMatchObject({
    id: user.id,
    firstName: committed?.firstName,
    lastName: committed?.lastName,
    updatedAt: committed?.updatedAt.toISOString(),
  });
  expect(updated.body.updatedAt).not.toBe(staleTimestamp.toISOString());

  const reread = await call("/me", { secret });
  expect(reread.body).toMatchObject({ firstName: "Ada", lastName: "Lovelace" });
});

test("sessions are listed for the credential's own account", async () => {
  const user = await seedUser();
  const secret = await seedKey({ userId: user.id, scopes: ["profile:read"] });

  const { response, body } = await call("/me/sessions", { secret });

  expect(response.status).toBe(200);
  // A bearer credential has no browser session of its own; the list is simply empty here.
  expect(Array.isArray(body)).toBe(true);
});

test("teams are listed and created", async () => {
  const user = await seedUser();
  const secret = await seedKey({ userId: user.id, scopes: ["teams:read", "teams:write"] });
  const teamId = await seedTeam({ userId: user.id });

  const listed = await call("/teams", { secret });
  expect(listed.response.status).toBe(200);
  expect((listed.body as unknown as { id: string }[]).map((team) => team.id)).toContain(teamId);

  const created = await call("/teams", { secret, method: "POST", body: { name: "Created By Api" } });
  expect(created.response.status).toBe(201);
  expect(created.body).toMatchObject({
    name: "Created By Api",
    role: { id: SYSTEM_ROLES_ENUM.OWNER },
  });
});

test("a team the credential is not a member of is not found", async () => {
  const [owner, outsider] = await Promise.all([seedUser(), seedUser()]);
  const teamId = await seedTeam({ userId: owner.id });
  const secret = await seedKey({ userId: outsider.id, scopes: ["teams:read"] });

  const { response, body } = await call(`/teams/${teamId}`, { secret });

  expect(response.status).toBe(404);
  expect(body.code).toBe("NOT_FOUND");
});

test("a team is renamed through the existing service", async () => {
  const user = await seedUser();
  const secret = await seedKey({ userId: user.id, scopes: ["teams:write"] });
  const teamId = await seedTeam({ userId: user.id });

  const { response, body } = await call(`/teams/${teamId}`, {
    secret,
    method: "PATCH",
    body: { name: "Renamed By Api" },
  });

  expect(response.status).toBe(200);
  expect(body).toMatchObject({ id: teamId, name: "Renamed By Api" });
});

test("team members are listed for a member of the team", async () => {
  const user = await seedUser();
  const secret = await seedKey({ userId: user.id, scopes: ["members:read"] });
  const teamId = await seedTeam({ userId: user.id });

  const { response, body } = await call(`/teams/${teamId}/members`, { secret });

  expect(response.status).toBe(200);
  expect((body as unknown as { userId: string }[]).map((member) => member.userId)).toEqual([user.id]);
});

// The scope is only half the check: team permissions stay D1-authoritative per request, so a
// plain member cannot remove anyone no matter what its credential was granted.
test("a scope cannot substitute for the team permission it does not have", async () => {
  const [owner, member] = await Promise.all([seedUser(), seedUser()]);
  const teamId = await seedTeam({ userId: owner.id });
  await seedMembership({ teamId, userId: member.id, roleId: SYSTEM_ROLES_ENUM.MEMBER });
  const secret = await seedKey({ userId: member.id, scopes: ["members:write"] });

  const { response, body } = await call(`/teams/${teamId}/members/${owner.id}`, {
    secret,
    method: "DELETE",
  });

  expect(response.status).toBe(403);
  expect(body.code).toBe("FORBIDDEN");
});

test("an owner removes a member", async () => {
  const [owner, member] = await Promise.all([seedUser(), seedUser()]);
  const teamId = await seedTeam({ userId: owner.id });
  await seedMembership({ teamId, userId: member.id, roleId: SYSTEM_ROLES_ENUM.MEMBER });
  const secret = await seedKey({ userId: owner.id, scopes: ["members:write"] });

  const { response, body } = await call(`/teams/${teamId}/members/${member.id}`, {
    secret,
    method: "DELETE",
  });

  expect(response.status).toBe(200);
  expect(body).toEqual({ success: true });
});

test("pending invitations are listed for a team", async () => {
  const user = await seedUser();
  const secret = await seedKey({ userId: user.id, scopes: ["members:read"] });
  const teamId = await seedTeam({ userId: user.id });

  const { response, body } = await call(`/teams/${teamId}/invitations`, { secret });

  expect(response.status).toBe(200);
  expect(body).toEqual([]);
});

test("a team's assignable roles are listed for discovery", async () => {
  const user = await seedUser();
  const secret = await seedKey({ userId: user.id, scopes: ["members:read"] });
  const teamId = await seedTeam({ userId: user.id });

  const { response, body } = await call(`/teams/${teamId}/roles`, { secret });
  const roles = body as unknown as Array<{ roleId: string; isAssignable: boolean }>;

  expect(response.status).toBe(200);
  // Every code-defined system role is reported, so a caller never has to guess a role id.
  expect(roles.map((role) => role.roleId).sort()).toEqual(
    Object.values(SYSTEM_ROLES_ENUM).sort(),
  );
  // Owner is listed (memberships report it) but an invitation can never grant it.
  expect(roles.find((role) => role.roleId === SYSTEM_ROLES_ENUM.OWNER)?.isAssignable).toBe(false);
  expect(roles.find((role) => role.roleId === SYSTEM_ROLES_ENUM.MEMBER)?.isAssignable).toBe(true);
});

// Regression: `inviteUserToTeam` is shared with the dashboard, and reaching for the App Router's
// `getTranslations`/`cookies()` there made every API and MCP invite a bare 500.
test.skipIf(!MULTI_SEAT_PLAN_ID)("an invitation is created without naming a role", async () => {
  const user = await seedUser();
  const secret = await seedKey({ userId: user.id, scopes: ["invites:write", "members:read"] });
  const teamId = await seedTeam({ userId: user.id, planId: MULTI_SEAT_PLAN_ID });

  const created = await call(`/teams/${teamId}/invitations`, {
    secret,
    method: "POST",
    body: { email: `invitee-${uid("x")}@example.com` },
  });

  expect(created.response.status).toBe(201);
  expect(created.body).toEqual({ success: true });

  const listed = await call(`/teams/${teamId}/invitations`, { secret });
  const invitations = listed.body as unknown as Array<{ roleId: string }>;

  // An omitted roleId resolves to the schema's default rather than being rejected.
  expect(invitations).toHaveLength(1);
  expect(invitations[0].roleId).toBe(SYSTEM_ROLES_ENUM.MEMBER);
});

test("an unknown role id is rejected with a detail that names the way out", async () => {
  const user = await seedUser();
  const secret = await seedKey({ userId: user.id, scopes: ["invites:write"] });
  const teamId = await seedTeam({ userId: user.id });

  const { response, body } = await call(`/teams/${teamId}/invitations`, {
    secret,
    method: "POST",
    body: { email: "invitee@example.com", roleId: "definitely-not-a-role" },
  });

  expect(response.status).toBe(400);
  expect(body.code).toBe("BAD_REQUEST");
  // The generic per-code sentence would send an agent hunting; the reason has to be specific.
  expect(body.detail).not.toBe(PROBLEM_BY_CODE.BAD_REQUEST.detail);
  expect(body.detail).toContain("listTeamRoles");
});

test("a full seat plan is reported as such, not as a generic denial", async () => {
  const user = await seedUser();
  const secret = await seedKey({ userId: user.id, scopes: ["invites:write"] });
  // Seeded with no subscription, so entitlements fall back to the default plan's seat limit,
  // which the owner's own membership already occupies on a single-seat plan.
  const teamId = await seedTeam({ userId: user.id });
  const { seats } = TEAM_PLANS[DEFAULT_PLAN_ID].limits;

  const { response, body } = await call(`/teams/${teamId}/invitations`, {
    secret,
    method: "POST",
    body: { email: "invitee@example.com" },
  });

  expect(response.status).toBe(403);
  expect(body.code).toBe("FORBIDDEN");
  expect(body.detail).not.toBe(PROBLEM_BY_CODE.FORBIDDEN.detail);
  // The limit itself is what tells a caller whether to upgrade or free a seat.
  expect(body.detail).toContain(String(seats));
});

test("billing is readable by a team member with the billing scope", async () => {
  const user = await seedUser();
  const secret = await seedKey({ userId: user.id, scopes: ["billing:read"] });
  const teamId = await seedTeam({ userId: user.id });

  const { response, body } = await call(`/teams/${teamId}/billing`, { secret });

  expect(response.status).toBe(200);
  expect(body).toMatchObject({ cancelAtPeriodEnd: false, needsPaymentAction: false });
  expect(typeof body.planId).toBe("string");
  // Read-only surface: nothing about Stripe leaves the API.
  expect(body).not.toHaveProperty("stripeSubscriptionId");
});

test("api keys are created, listed, and revoked over the API", async () => {
  const user = await seedUser();
  const secret = await seedKey({
    userId: user.id,
    scopes: ["api-keys:read", "api-keys:write", "profile:read"],
  });

  const created = await call("/api-keys", {
    secret,
    method: "POST",
    body: { name: "minted", scopes: ["profile:read"] },
  });

  expect(created.response.status).toBe(201);
  const mintedSecret = created.body.secret as string;
  const mintedId = (created.body.key as { id: string }).id;
  expect(mintedSecret).toBeTruthy();

  // The minted key really works, with exactly the scopes it was granted.
  expect((await call("/me", { secret: mintedSecret })).response.status).toBe(200);

  const listed = await call("/api-keys", { secret });
  expect((listed.body as unknown as { id: string }[]).map((key) => key.id)).toContain(mintedId);
  // A listing can never expose the secret again.
  expect(JSON.stringify(listed.body)).not.toContain(mintedSecret);

  const revoked = await call(`/api-keys/${mintedId}`, { secret, method: "DELETE" });
  expect(revoked.response.status).toBe(200);
  expect((await call("/me", { secret: mintedSecret })).response.status).toBe(401);
});

test("a key's scopes are replaced over the API and take effect immediately", async () => {
  const user = await seedUser();
  const secret = await seedKey({
    userId: user.id,
    scopes: ["api-keys:write", "profile:read", "teams:read"],
  });

  const created = await call("/api-keys", {
    secret,
    method: "POST",
    body: { name: "rescoped", scopes: ["profile:read", "teams:read"] },
  });
  const mintedSecret = created.body.secret as string;
  const mintedId = (created.body.key as { id: string }).id;

  expect((await call("/teams", { secret: mintedSecret })).response.status).toBe(200);

  const updated = await call(`/api-keys/${mintedId}`, {
    secret,
    method: "PATCH",
    body: { scopes: ["profile:read"] },
  });

  expect(updated.response.status).toBe(200);
  expect(updated.body).toMatchObject({ id: mintedId, scopes: ["profile:read"] });
  // The response documents a key, never a secret — the edit path cannot re-reveal one.
  expect(JSON.stringify(updated.body)).not.toContain(mintedSecret);

  // The dropped scope stops working without waiting for a cached principal to expire.
  expect((await call("/me", { secret: mintedSecret })).response.status).toBe(200);
  expect((await call("/teams", { secret: mintedSecret })).response.status).toBe(403);
});

test("a revoked key cannot be re-scoped", async () => {
  const user = await seedUser();
  const secret = await seedKey({ userId: user.id, scopes: ["api-keys:write", "profile:read"] });

  const created = await call("/api-keys", {
    secret,
    method: "POST",
    body: { name: "doomed", scopes: ["profile:read"] },
  });
  const mintedId = (created.body.key as { id: string }).id;

  await call(`/api-keys/${mintedId}`, { secret, method: "DELETE" });

  const { response, body } = await call(`/api-keys/${mintedId}`, {
    secret,
    method: "PATCH",
    body: { scopes: ["profile:read"] },
  });

  expect(response.status).toBe(404);
  expect(body.code).toBe("NOT_FOUND");
});

// No privilege escalation: a key is always a subset of the credential that minted it.
test("a key cannot mint another key with scopes it does not hold", async () => {
  const user = await seedUser();
  const secret = await seedKey({ userId: user.id, scopes: ["api-keys:write"] });

  const { response, body } = await call("/api-keys", {
    secret,
    method: "POST",
    body: { name: "escalated", scopes: ["teams:write"] },
  });

  expect(response.status).toBe(403);
  expect(body.code).toBe("FORBIDDEN");
});

test("an unknown scope is rejected before it can be granted", async () => {
  const user = await seedUser();
  const secret = await seedKey({ userId: user.id, scopes: ["api-keys:write"] });

  const { response } = await call("/api-keys", {
    secret,
    method: "POST",
    body: { name: "bogus", scopes: ["not:a-scope"] },
  });

  expect(response.status).toBe(400);
  expect(API_SCOPE_NAMES).not.toContain("not:a-scope");
});

// Service-layer errors keep their stable code through the mapper rather than becoming a 500.
test("a service precondition failure maps to its own status", async () => {
  const user = await seedUser();
  const secret = await seedKey({ userId: user.id, scopes: ["teams:write"] });

  for (let i = 0; i < MAX_TEAMS_CREATED_PER_USER; i++) {
    await seedTeam({ userId: user.id });
  }

  const { response, body } = await call("/teams", {
    secret,
    method: "POST",
    body: { name: "One Too Many" },
  });

  expect(response.status).toBe(403);
  expect(body.code).toBe("FORBIDDEN");
});

// ---------------------------------------------------------------------------
// Credential introspection.
//
// The one operation no scope narrows, and the only account-tagged one a team key can reach. It
// exists because every other refusal tells a caller what it may not do; this tells it what it may.
// ---------------------------------------------------------------------------

test("a personal key describes itself without a team", async () => {
  const user = await seedUser();
  const scopes: ApiScope[] = [API_SCOPE_NAMES[0]];
  const secret = await seedKey({ userId: user.id, scopes });

  const { response, body } = await call("/credential", { secret });

  expect(response.status).toBe(200);
  expect(body).toEqual({ kind: "api-key", audience: "personal", team: null, scopes });
});

// The question this endpoint was added for: a team key can reach it, and it names the team. The id
// is the whole payload — name and slug belong to `teams:read`, which this route never demands.
test("a team key describes itself and names its team by id alone", async () => {
  const user = await seedUser();
  const teamId = await seedTeam({ userId: user.id });
  const scopes: ApiScope[] = [TEAM_KEY_SCOPES[0]];
  const secret = await seedKey({ userId: user.id, teamId, scopes });

  const { response, body } = await call("/credential", { secret });

  expect(response.status).toBe(200);
  expect(body).toEqual({ kind: "api-key", audience: "team", team: { id: teamId }, scopes });
});

// A team key whose owner has lost the membership can do nothing on that team, and this route is
// where the holder finds that out — so it must still name the team that confines the key.
test("a team key whose membership is gone still reports its team id", async () => {
  const user = await seedUser();
  const teamId = await seedTeam({ userId: user.id });
  const secret = await seedKey({ userId: user.id, teamId, scopes: [TEAM_KEY_SCOPES[0]] });

  await db.delete(teamMembershipTable).where(eq(teamMembershipTable.teamId, teamId));

  const { response, body } = await call("/credential", { secret });

  expect(response.status).toBe(200);
  expect(body).toMatchObject({ audience: "team", team: { id: teamId } });
});

// The reason the endpoint reports scopes at all: the stored grant and the enforced one differ on a
// team key issued before account-only scopes were refused, and nothing else shows the holder which.
test.skipIf(!API_SCOPE_NAMES.some(isAccountOnlyScope))(
  "the scopes reported are the ones in force, not the ones stored",
  async () => {
    const user = await seedUser();
    const teamId = await seedTeam({ userId: user.id });
    const accountOnly = API_SCOPE_NAMES.filter(isAccountOnlyScope);
    const secret = await seedKey({
      userId: user.id,
      teamId,
      scopes: [TEAM_KEY_SCOPES[0], ...accountOnly],
    });

    const { body } = await call("/credential", { secret });

    expect(body.scopes).toEqual([TEAM_KEY_SCOPES[0]]);
  },
);

// Unscoped means unscoped, not unauthenticated: the only credential it turns away is none.
test("credential introspection needs a credential but no scope", async () => {
  const user = await seedUser();
  const scopeless = await seedKey({ userId: user.id, scopes: [] });

  await expect(call("/credential", { secret: scopeless })).resolves.toMatchObject({
    response: { status: 200 },
    body: { scopes: [] },
  });

  const anonymous = await call("/credential");
  expect(anonymous.response.status).toBe(401);
  expect(anonymous.body.code).toBe("NOT_AUTHORIZED");
});

// ---------------------------------------------------------------------------
// Team-key audience.
//
// A key with a `teamId` is confined to that team: it may act on it exactly as its creator's
// permissions allow, and on nothing else. A key without one, and every OAuth grant, stays an
// account credential. Audience only ever narrows, exactly like a scope.
// ---------------------------------------------------------------------------

test("a team key acts on its own team exactly as a personal key would", async () => {
  const user = await seedUser();
  const teamId = await seedTeam({ userId: user.id });
  const secret = await seedKey({
    userId: user.id,
    teamId,
    scopes: ["teams:read", "teams:write", "members:read", "billing:read"],
  });

  const read = await call(`/teams/${teamId}`, { secret });
  expect(read.response.status).toBe(200);
  expect(read.body).toMatchObject({ id: teamId });

  const renamed = await call(`/teams/${teamId}`, {
    secret,
    method: "PATCH",
    body: { name: "Renamed By Team Key" },
  });
  expect(renamed.response.status).toBe(200);

  const members = await call(`/teams/${teamId}/members`, { secret });
  expect(members.response.status).toBe(200);

  const billing = await call(`/teams/${teamId}/billing`, { secret });
  expect(billing.response.status).toBe(200);
});

test("a team key is refused on every other team its creator belongs to", async () => {
  const user = await seedUser();
  const [audienceTeamId, otherTeamId] = await Promise.all([
    seedTeam({ userId: user.id }),
    seedTeam({ userId: user.id }),
  ]);
  const secret = await seedKey({
    userId: user.id,
    teamId: audienceTeamId,
    scopes: ["teams:read", "teams:write", "members:read", "members:write", "invites:write", "billing:read"],
  });

  const refusals = await Promise.all([
    call(`/teams/${otherTeamId}`, { secret }),
    call(`/teams/${otherTeamId}`, { secret, method: "PATCH", body: { name: "Nope" } }),
    call(`/teams/${otherTeamId}/members`, { secret }),
    call(`/teams/${otherTeamId}/members/${user.id}`, { secret, method: "DELETE" }),
    call(`/teams/${otherTeamId}/roles`, { secret }),
    call(`/teams/${otherTeamId}/invitations`, { secret }),
    call(`/teams/${otherTeamId}/invitations`, {
      secret,
      method: "POST",
      body: { email: "invitee@example.com" },
    }),
    call(`/teams/${otherTeamId}/billing`, { secret }),
  ]);

  for (const { response, body } of refusals) {
    expect(response.status).toBe(403);
    expect(body.code).toBe("FORBIDDEN");
    // The audience team is what tells an agent which credential to reach for instead.
    expect(body.detail).toContain(audienceTeamId);
  }
});

// The refusal has to beat the validator, or a credential that may not call the operation at all
// learns its request schema from a 400.
test("a team key is refused before another team's request body is validated", async () => {
  const user = await seedUser();
  const [audienceTeamId, otherTeamId] = await Promise.all([
    seedTeam({ userId: user.id }),
    seedTeam({ userId: user.id }),
  ]);
  const secret = await seedKey({ userId: user.id, teamId: audienceTeamId, scopes: ["teams:write"] });

  const { response, body } = await call(`/teams/${otherTeamId}`, {
    secret,
    method: "PATCH",
    body: { wrong: "shape" },
  });

  expect(response.status).toBe(403);
  expect(body.errors).toBeUndefined();
});

test("a team key is refused on account-level operations", async () => {
  const user = await seedUser();
  const teamId = await seedTeam({ userId: user.id });
  const secret = await seedKey({
    userId: user.id,
    teamId,
    // Every scope these operations need, so each refusal below can only be about the audience.
    scopes: ["profile:read", "profile:write", "teams:write", "api-keys:read", "api-keys:write"],
  });

  const refusals = await Promise.all([
    call("/me", { secret }),
    call("/me", { secret, method: "PATCH", body: { firstName: "Ada", lastName: "Lovelace" } }),
    call("/me/sessions", { secret }),
    call(`/me/sessions/${uid("sess")}`, { secret, method: "DELETE" }),
    call("/teams", { secret, method: "POST", body: { name: "Not Allowed" } }),
    call("/api-keys", { secret }),
    call("/api-keys", { secret, method: "POST", body: { name: "minted", scopes: ["profile:read"] } }),
    call(`/api-keys/${uid("akey")}`, { secret, method: "PATCH", body: { scopes: ["profile:read"] } }),
    call(`/api-keys/${uid("akey")}`, { secret, method: "DELETE" }),
  ]);

  for (const { response, body } of refusals) {
    expect(response.status).toBe(403);
    expect(body.code).toBe("FORBIDDEN");
    expect(body.detail).toContain(teamId);
  }
});

// The escalation guard composes with the audience one rather than being reached past it: a team
// key can never mint a credential at all, so it can never widen its own audience.
test("a team key mints nothing, not even a key for its own team", async () => {
  const user = await seedUser();
  const teamId = await seedTeam({ userId: user.id });
  const secret = await seedKey({ userId: user.id, teamId, scopes: ["api-keys:write"] });

  const { response } = await call("/api-keys", {
    secret,
    method: "POST",
    body: { name: "second generation", scopes: ["api-keys:write"], teamId },
  });

  expect(response.status).toBe(403);
  expect(await db.query.apiKeyTable.findMany({ where: { name: "second generation" } })).toEqual([]);
});

test("listing teams returns only the audience team for a team key", async () => {
  const user = await seedUser();
  const [audienceTeamId, otherTeamId] = await Promise.all([
    seedTeam({ userId: user.id }),
    seedTeam({ userId: user.id }),
  ]);

  const [teamSecret, personalSecret] = await Promise.all([
    seedKey({ userId: user.id, teamId: audienceTeamId, scopes: ["teams:read"] }),
    seedKey({ userId: user.id, scopes: ["teams:read"] }),
  ]);

  const scoped = await call("/teams", { secret: teamSecret });
  expect(scoped.response.status).toBe(200);
  expect((scoped.body as unknown as { id: string }[]).map((team) => team.id)).toEqual([audienceTeamId]);

  // The same account, through a personal key, still sees both: the audience narrows, never the row.
  const personal = await call("/teams", { secret: personalSecret });
  expect((personal.body as unknown as { id: string }[]).map((team) => team.id).sort())
    .toEqual([audienceTeamId, otherTeamId].sort());
});

// A team key stays bounded by its creator's live D1 permissions: audience narrows, it never grants.
test("a team key does not lend its holder permissions on its own team", async () => {
  const [owner, member] = await Promise.all([seedUser(), seedUser()]);
  const teamId = await seedTeam({ userId: owner.id });
  await seedMembership({ teamId, userId: member.id, roleId: SYSTEM_ROLES_ENUM.MEMBER });
  const secret = await seedKey({ userId: member.id, teamId, scopes: ["members:write"] });

  const { response, body } = await call(`/teams/${teamId}/members/${owner.id}`, {
    secret,
    method: "DELETE",
  });

  expect(response.status).toBe(403);
  expect(body.code).toBe("FORBIDDEN");
});
