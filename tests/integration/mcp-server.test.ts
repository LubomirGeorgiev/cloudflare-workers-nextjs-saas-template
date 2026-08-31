/// <reference types="@cloudflare/vitest-plugin/types" />

// The remote MCP server over real Streamable HTTP, driven through the Worker entrypoint so the
// whole funnel is under test: OAuth-provider bearer validation, the principal build, spec-driven
// tool derivation, and in-process dispatch into the REST layer.
//
// Both credential types are exercised — an API key and an OAuth access token minted through the
// Phase 3 consent + code-exchange dance — because agent clients use whichever their host supports.
//
// Assertions derive from the app's own scope catalog and its generated OpenAPI document, so a fork
// that adds, renames, or hides endpoints keeps them valid.

import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { expect, test, vi } from "vitest";

import {
  API_OPENAPI_SPEC_PATH,
  MCP_PATH,
  OAUTH_OPEN_DCR_ENABLED,
  OAUTH_PROTECTED_RESOURCE_PATH,
  OAUTH_REGISTER_PATH,
  OAUTH_TOKEN_PATH,
} from "@/constants";
import { DEFAULT_PLAN_ID, TEAM_PLANS, TEAM_PLAN_IDS } from "@/constants/plans";
import { getDB } from "@/db";
import {
  SYSTEM_ROLES_ENUM,
  apiKeyTable,
  teamMembershipTable,
  teamTable,
  userTable,
} from "@/db/schema";
import { API_SCOPE_NAMES, TEAM_KEY_SCOPES, type ApiScope } from "@/lib/api/scopes";
import { resolveConsentRequest } from "@/lib/oauth/consent";
import { getOAuthHelpers } from "@/lib/oauth/provider-api";
import { deriveMcpTools } from "@/mcp/derive-tools";
import { generateApiKey } from "@/utils/api-key-format";
import { eq } from "drizzle-orm";

const innerFetchMock = vi.hoisted(() => vi.fn());

vi.mock("vinext/server/fetch-handler", () => ({
  default: { fetch: innerFetchMock },
}));

const { default: worker } = await import("../../worker-entrypoint");

const ORIGIN = "https://example.com";
const REDIRECT_URI = "https://agent.example.org/callback";
const db = getDB();

// Derived, never hard-coded: an invite only fits on a plan whose seat limit leaves room beyond
// the owner. Undefined in a fork that sells no multi-seat plan, which stops at the refusal half.
const MULTI_SEAT_PLAN_ID = TEAM_PLAN_IDS.find((id) => TEAM_PLANS[id].limits.seats > 1);

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

function callWorker(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}${path}`, init), env as Env, createExecutionContext());
}

interface JsonRpcResponse {
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
  outputSchema?: Record<string, unknown>;
}

interface ToolCallResult {
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

// The stateless transport answers over SSE; one exchange carries exactly one message frame.
function readSseMessage(payload: string): JsonRpcResponse {
  const line = payload.split("\n").find((candidate) => candidate.startsWith("data: "));

  if (!line) {
    throw new Error(`No SSE message in response: ${payload}`);
  }

  return JSON.parse(line.slice("data: ".length)) as JsonRpcResponse;
}

let requestId = 0;

async function mcpCall({
  token,
  method,
  params = {},
}: {
  token: string;
  method: string;
  params?: Record<string, unknown>;
}): Promise<JsonRpcResponse> {
  requestId += 1;

  const response = await callWorker(MCP_PATH, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
  });

  expect(response.status).toBe(200);

  return readSseMessage(await response.text());
}

async function listTools(token: string): Promise<McpTool[]> {
  const message = await mcpCall({ token, method: "tools/list" });

  return (message.result?.tools ?? []) as McpTool[];
}

async function callTool({
  token,
  name,
  args = {},
}: {
  token: string;
  name: string;
  args?: Record<string, unknown>;
}): Promise<ToolCallResult> {
  const message = await mcpCall({ token, method: "tools/call", params: { name, arguments: args } });

  expect(message.error).toBeUndefined();

  return message.result as unknown as ToolCallResult;
}

async function seedUser(): Promise<{ id: string; email: string }> {
  const id = uid("usr");
  const email = `${id}@example.com`;

  await db.insert(userTable).values({
    id,
    email,
    firstName: "Mcp",
    lastName: "Agent",
    emailVerified: new Date(),
  });

  return { id, email };
}

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
    name: "mcp integration",
    keyHash: generated.hash,
    keyPrefix: generated.prefix,
    last4: generated.last4,
    scopes,
    teamId,
  });

  return generated.secret;
}

async function seedKeyedUser(scopes: ApiScope[]): Promise<{ user: { id: string; email: string }; token: string }> {
  const user = await seedUser();

  return { user, token: await seedKey({ userId: user.id, scopes }) };
}

test("an unauthenticated client is told where to authenticate", async () => {
  const response = await callWorker(MCP_PATH, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });

  expect(response.status).toBe(401);
  // RFC 9728: this pointer is what makes "paste the URL" start the OAuth dance unattended.
  expect(response.headers.get("www-authenticate")).toContain(
    `resource_metadata="${ORIGIN}${OAUTH_PROTECTED_RESOURCE_PATH}${MCP_PATH}"`,
  );
  expect(innerFetchMock).not.toHaveBeenCalled();
});

test("the handshake identifies the server and advertises tools", async () => {
  const { token } = await seedKeyedUser(["profile:read"]);

  const message = await mcpCall({
    token,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "integration", version: "1.0.0" },
    },
  });

  expect(message.error).toBeUndefined();
  expect(message.result?.serverInfo).toMatchObject({ name: expect.any(String) });
  expect(message.result?.capabilities).toMatchObject({ tools: expect.any(Object) });
});

// The template's defining property: the tool surface is the API surface, with no hand-written list
// to drift. Expectations come from the same document the docs UI reads.
test("every operation the credential can reach is a tool, derived from the spec", async () => {
  const { token } = await seedKeyedUser([...API_SCOPE_NAMES]);

  const specResponse = await callWorker(API_OPENAPI_SPEC_PATH);
  expect(specResponse.status).toBe(200);
  const document = await specResponse.json() as Parameters<typeof deriveMcpTools>[0]["document"];

  const expected = deriveMcpTools({ document }).map((tool) => tool.name).sort();
  const advertised = (await listTools(token)).map((tool) => tool.name).sort();

  expect(expected.length).toBeGreaterThan(0);
  expect(advertised).toEqual(expected);
});

test("tools/list is filtered by the credential's scopes", async () => {
  const [readOnly, writer] = await Promise.all([
    seedKeyedUser(["teams:read"]),
    seedKeyedUser(["teams:read", "teams:write"]),
  ]);

  const readOnlyNames = (await listTools(readOnly.token)).map((tool) => tool.name);
  const writerNames = (await listTools(writer.token)).map((tool) => tool.name);

  expect(readOnlyNames).toContain("listTeams");
  expect(readOnlyNames).not.toContain("createTeam");
  expect(writerNames).toContain("createTeam");
  // A scope the key does not hold hides its tools entirely, whatever the operation.
  expect(writerNames).not.toContain("getMe");
  // Except the unscoped one: an agent has to be able to ask what it holds before it asks for more.
  expect(readOnlyNames).toContain("getCredential");
});

// The endpoint earns its keep here: an agent whose call was refused can ask one tool what its
// credential actually is, instead of guessing from a 403. Reachable by every credential, so the
// team key below — which sees no account tool at all — still sees this one.
test("an agent can ask what its own credential is, whatever it holds", async () => {
  const user = await seedUser();
  const teamId = uid("team");

  // A real membership, unlike the refusal tests above, so the agent asks about a live team key.
  await db.insert(teamTable).values({ id: teamId, name: "Audience Team", slug: uid("audience") });
  await db.insert(teamMembershipTable).values({
    teamId,
    userId: user.id,
    roleId: SYSTEM_ROLES_ENUM.OWNER,
    isSystemRole: 1,
  });

  const token = await seedKey({ userId: user.id, teamId, scopes: [...API_SCOPE_NAMES] });

  expect((await listTools(token)).map((tool) => tool.name)).toContain("getCredential");

  const result = await callTool({ token, name: "getCredential", args: {} });

  expect(result.isError).toBeFalsy();

  const credential = JSON.parse(result.content[0]!.text) as {
    audience: string;
    team: { id: string } | null;
    scopes: string[];
  };

  expect(credential.audience).toBe("team");
  expect(credential.team?.id).toBe(teamId);
  // The account-only scopes it was seeded with are gone, which is the answer it came for.
  expect(credential.scopes).toEqual([...TEAM_KEY_SCOPES]);
});

// Path parameters, query parameters, and the request body are merged into one argument object, so
// an agent never has to know which part of the HTTP request a field belongs to.
test("a derived tool merges path parameters and body fields into one input schema", async () => {
  const { token } = await seedKeyedUser(["teams:write"]);
  const updateTeam = (await listTools(token)).find((tool) => tool.name === "updateTeam");

  expect(Object.keys(updateTeam?.inputSchema?.properties ?? {})).toEqual(
    expect.arrayContaining(["teamId", "name"]),
  );
  expect(updateTeam?.inputSchema?.required).toEqual(expect.arrayContaining(["teamId", "name"]));
  expect((updateTeam?.description ?? "").length).toBeGreaterThan(40);
});

test("a mutating tool call round-trips through the REST layer into the database", async () => {
  const { user, token } = await seedKeyedUser(["teams:write", "teams:read"]);
  const name = uid("Team By Agent");

  const created = await callTool({ token, name: "createTeam", args: { name } });

  expect(created.isError).toBeFalsy();
  expect(created.structuredContent).toMatchObject({ name, role: { id: "owner" } });

  const teamId = created.structuredContent?.id as string;
  const [row] = await db.select().from(teamTable).where(eq(teamTable.id, teamId));
  expect(row?.name).toBe(name);

  const renamed = await callTool({
    token,
    name: "updateTeam",
    args: { teamId, name: `${name} Renamed` },
  });
  expect(renamed.structuredContent).toMatchObject({ id: teamId, name: `${name} Renamed` });

  // The reader sees the write through the same credential, so the whole loop is real.
  const listed = await callTool({ token, name: "listTeams" });
  expect(listed.content[0]?.text).toContain(teamId);
  expect(user.id).toBeTruthy();
});

// The sequence a real agent runs, end to end over MCP. Inviting used to answer a bare 500 here:
// `inviteUserToTeam` is shared with the dashboard and reached for the App Router request scope,
// which this handler does not have. The rest of the test is the other half of that failure — an
// agent can only recover from a refusal that says which limit it hit.
test("an agent creates a team, discovers its roles, and invites a member", async () => {
  const { token } = await seedKeyedUser(["teams:write", "invites:write", "members:read"]);
  const created = await callTool({ token, name: "createTeam", args: { name: uid("Agent Team") } });
  const teamId = created.structuredContent?.id as string;

  const roles = await callTool({ token, name: "listTeamRoles", args: { teamId } });
  expect(roles.isError).toBeFalsy();
  // Discovery exists precisely so the role argument below never has to be guessed.
  expect(roles.content[0]?.text).toContain(SYSTEM_ROLES_ENUM.MEMBER);

  // A new team is on the default plan, whose seats the owner's own membership already fills.
  const denied = await callTool({
    token,
    name: "createTeamInvitation",
    args: { teamId, email: `${uid("invitee")}@example.com` },
  });

  expect(denied.isError).toBe(true);
  expect(denied.content[0]?.text).toContain(String(TEAM_PLANS[DEFAULT_PLAN_ID].limits.seats));

  if (!MULTI_SEAT_PLAN_ID) {
    return;
  }

  await db
    .update(teamTable)
    .set({ subscriptionPlanId: MULTI_SEAT_PLAN_ID, subscriptionStatus: "active" })
    .where(eq(teamTable.id, teamId));

  // Same call, one seat freed: it succeeds without ever naming a role.
  const invited = await callTool({
    token,
    name: "createTeamInvitation",
    args: { teamId, email: `${uid("invitee")}@example.com` },
  });

  expect(invited.isError).toBeFalsy();
  expect(invited.structuredContent).toMatchObject({ success: true });
});

// Problem documents keep their stable code, which is what an agent can actually act on.
test("a failing operation becomes a tool error carrying the API's stable code", async () => {
  const { token } = await seedKeyedUser(["teams:read"]);

  const result = await callTool({ token, name: "getTeam", args: { teamId: uid("missing") } });

  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain("NOT_FOUND");
});

// Tools dispatch in-process through `apiApp.fetch`, so the audience guard is inherited rather
// than re-implemented — this is the proof that an agent holding a team key inherits it.
test("a team-scoped key carries its audience into MCP tool calls", async () => {
  const user = await seedUser();
  const [audienceTeamId, otherTeamId] = [uid("team"), uid("team")];

  await db.insert(teamTable).values([
    { id: audienceTeamId, name: "Audience Team", slug: uid("audience") },
    { id: otherTeamId, name: "Other Team", slug: uid("other") },
  ]);

  const token = await seedKey({
    userId: user.id,
    teamId: audienceTeamId,
    scopes: ["teams:read", "profile:read"],
  });

  const refused = await callTool({ token, name: "getTeam", args: { teamId: otherTeamId } });
  expect(refused.isError).toBe(true);
  expect(refused.content[0]?.text).toContain("FORBIDDEN");
  // The detail names the key's own team, which is what an agent can act on.
  expect(refused.content[0]?.text).toContain(audienceTeamId);

  // An account-level tool is not advertised to this key at all, and asking for it by name is
  // rejected by the transport rather than dispatched — the guard behind it is unchanged.
  expect((await listTools(token)).map((tool) => tool.name)).not.toContain("getMe");

  const account = await mcpCall({
    token,
    method: "tools/call",
    params: { name: "getMe", arguments: {} },
  });
  expect(account.error).toBeTruthy();
});

// A team credential is refused every account-level operation whatever its scopes, so those tools
// can only ever answer 403 for it. The split comes from the document, so a fork's own routes are
// covered without naming any of them here.
test("tools/list hides account-audience tools from a team-scoped key", async () => {
  const user = await seedUser();
  const teamId = uid("team");

  await db.insert(teamTable).values({ id: teamId, name: "Audience Team", slug: uid("audience") });

  const [teamToken, personalToken] = await Promise.all([
    seedKey({ userId: user.id, teamId, scopes: [...API_SCOPE_NAMES] }),
    seedKey({ userId: user.id, scopes: [...API_SCOPE_NAMES] }),
  ]);

  const specResponse = await callWorker(API_OPENAPI_SPEC_PATH);
  const document = await specResponse.json() as Parameters<typeof deriveMcpTools>[0]["document"];
  const derived = deriveMcpTools({ document });
  const accountOnly = derived.filter((tool) => tool.audience === "account");
  const teamReachable = derived.filter((tool) => tool.audience !== "account");

  expect(accountOnly.length).toBeGreaterThan(0);
  expect(teamReachable.length).toBeGreaterThan(0);

  const teamNames = (await listTools(teamToken)).map((tool) => tool.name).sort();
  expect(teamNames).toEqual(teamReachable.map((tool) => tool.name).sort());

  // The same account through a personal key still sees everything: audience narrows, never widens.
  const personalNames = (await listTools(personalToken)).map((tool) => tool.name).sort();
  expect(personalNames).toEqual(derived.map((tool) => tool.name).sort());
});

test("an unknown tool name is rejected rather than dispatched", async () => {
  const { token } = await seedKeyedUser(["profile:read"]);

  const message = await mcpCall({
    token,
    method: "tools/call",
    params: { name: "definitelyNotATool", arguments: {} },
  });

  expect(message.error).toBeTruthy();
});

// The other half of the dual-auth promise: claude.ai-class clients have no bearer field and must
// arrive through the OAuth flow, landing on exactly the same handler with the same principal.
test.skipIf(!OAUTH_OPEN_DCR_ENABLED)("an OAuth access token drives the same tool surface", async () => {
  const user = await seedUser();

  const registration = await callWorker(OAUTH_REGISTER_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Mcp Test Agent",
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    }),
  });
  expect(registration.status).toBe(201);
  const { client_id: clientId } = await registration.json() as { client_id: string };

  const verifier = crypto.randomUUID().replace(/-/g, "");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const authQuery = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    scope: "teams:read",
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  const consent = await resolveConsentRequest({ authQuery: authQuery });
  const { redirectTo } = await getOAuthHelpers().completeAuthorization({
    request: consent.authRequest,
    userId: user.id,
    scope: consent.grantedScopes,
    props: { credentialKind: "oauth-grant", userId: user.id, clientId },
    metadata: { createdAt: Date.now(), clientNameAtConsent: consent.clientName },
  });

  const tokenResponse = await callWorker(OAUTH_TOKEN_PATH, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: new URL(redirectTo).searchParams.get("code")!,
      redirect_uri: REDIRECT_URI,
      client_id: clientId,
      code_verifier: verifier,
    }),
  });
  expect(tokenResponse.status).toBe(200);
  const { access_token: accessToken } = await tokenResponse.json() as { access_token: string };

  const names = (await listTools(accessToken)).map((tool) => tool.name);
  expect(names).toContain("listTeams");
  // The grant's scope is the ceiling here too, exactly as it is for an API key.
  expect(names).not.toContain("createTeam");

  const listed = await callTool({ token: accessToken, name: "listTeams" });
  expect(listed.isError).toBeFalsy();
  expect(innerFetchMock).not.toHaveBeenCalled();
});
