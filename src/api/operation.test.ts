import { Hono } from "hono";
import { describe, expect, test, vi } from "vitest";

import type { ApiEnv } from "@/api/types";
import { minString, v } from "@/lib/validation";
import type { ApiPrincipal } from "@/lib/api/principal";
import { API_SCOPE_NAMES } from "@/lib/api/scopes";

vi.mock("server-only", () => ({}));

// The problem mapper reaches the KV limiter through `with-rate-limit`; stubbing it keeps the
// Worker-only `cloudflare:workers` import out of a plain unit run.
vi.mock("@/utils/get-IP", () => ({ getIP: vi.fn() }));

vi.mock("@/utils/is-test-mode", () => ({ isTestMode: () => false }));

vi.mock("@/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  resetRateLimit: vi.fn(),
}));

const { apiValidator, problemJsonErrorHandler } = await import("@/api/middleware/problem-json");
const { apiOperation, readOperationPolicy } = await import("@/api/operation");
const { runWithPrincipal, toApiAudience } = await import("@/lib/api/principal");

const ACCOUNT_SCOPE = "profile:write";
const TEAM_SCOPE = "teams:write";
const OWN_TEAM_ID = "team_own";
const OTHER_TEAM_ID = "team_other";
const bodySchema = v.object({ name: minString(1) });
const OK_RESPONSE = { 200: { description: "ok" } };

// Holds the whole catalog unless a test narrows it, so an audience test can only ever fail on the
// audience. There is no "unrestricted" principal: a cookie caller never enters the ALS at all.
function principal({
  scopes = [...API_SCOPE_NAMES],
  teamId = null,
}: { scopes?: string[]; teamId?: string | null } = {}): ApiPrincipal {
  return {
    kind: "api-key",
    keyId: "akey_1",
    userId: "user_1",
    scopes,
    audience: toApiAudience(teamId),
  } as ApiPrincipal;
}

// Mirrors real routes: the guard is spread ahead of the validator, which is the whole point.
function createApp() {
  const app = new Hono<ApiEnv>();
  app.onError(problemJsonErrorHandler);

  app.patch(
    "/me",
    ...apiOperation({
      operationId: "updateMe",
      summary: "Update the account",
      scope: ACCOUNT_SCOPE,
      audience: "account",
      responses: OK_RESPONSE,
    }),
    apiValidator("json", bodySchema),
    (c) => c.json(c.req.valid("json")),
  );

  app.patch(
    "/teams/:teamId",
    ...apiOperation({
      operationId: "updateTeam",
      summary: "Rename a team",
      scope: TEAM_SCOPE,
      audience: "team",
      responses: OK_RESPONSE,
    }),
    apiValidator("json", bodySchema),
    (c) => c.json(c.req.valid("json")),
  );

  app.get(
    "/teams",
    ...apiOperation({
      operationId: "listTeams",
      summary: "List teams",
      scope: "teams:read",
      audience: "any",
      responses: OK_RESPONSE,
    }),
    (c) => c.json({ ok: true }),
  );

  return app;
}

async function call({
  path,
  method = "PATCH",
  scopes,
  teamId = null,
  body,
  withoutCredential = false,
}: {
  path: string;
  method?: string;
  scopes?: string[];
  teamId?: string | null;
  body?: unknown;
  withoutCredential?: boolean;
}) {
  const request = new Request(`http://localhost${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const fetchApp = () => createApp().fetch(request);
  const response = withoutCredential
    ? await fetchApp()
    : await runWithPrincipal(principal({ scopes, teamId }), fetchApp);

  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe("scope enforcement", () => {
  test("refuses an out-of-scope credential before the body is validated", async () => {
    const { status, body } = await call({
      path: "/me",
      scopes: ["profile:read"],
      body: { wrong: "shape" },
    });

    expect(status).toBe(403);
    expect(body.code).toBe("FORBIDDEN");
    // The regression: validating first answered 400 and disclosed the schema to a caller that is
    // not allowed to call the operation at all.
    expect(body.errors).toBeUndefined();
  });

  test("names the missing scope in the detail so an agent can request it", async () => {
    const { body } = await call({ path: "/me", scopes: [], body: {} });

    expect(body.detail).toContain(ACCOUNT_SCOPE);
  });

  test("still validates the body once the scope is held", async () => {
    const { status, body } = await call({
      path: "/me",
      scopes: [ACCOUNT_SCOPE],
      body: { wrong: "shape" },
    });

    expect(status).toBe(400);
    expect(body.code).toBe("INPUT_PARSE_ERROR");
  });

  test("passes a request that holds the scope and a valid body", async () => {
    const { status, body } = await call({
      path: "/me",
      scopes: [ACCOUNT_SCOPE],
      body: { name: "ok" },
    });

    expect(status).toBe(200);
    expect(body.name).toBe("ok");
  });

  test("lets a credential holding the whole catalog through to the handler", async () => {
    const { status } = await call({ path: "/me", body: { name: "ok" } });

    expect(status).toBe(200);
  });

  // Fails closed: the guard runs inside the API layer, which always establishes a principal, so
  // reaching it without one means the request was never authenticated.
  test("refuses a request that carries no credential at all", async () => {
    const { status } = await call({ path: "/me", body: { name: "ok" }, withoutCredential: true });

    expect(status).toBe(401);
  });
});

describe("account audience", () => {
  test("refuses a team credential before the body is validated", async () => {
    const { status, body } = await call({ path: "/me", teamId: OWN_TEAM_ID, body: { wrong: 1 } });

    expect(status).toBe(403);
    expect(body.code).toBe("FORBIDDEN");
    // Same reason the scope guard runs first: a caller that may not call the operation at all
    // must not learn its request schema from a 400.
    expect(body.errors).toBeUndefined();
  });

  test("names the audience team so an agent knows which credential to swap", async () => {
    const { body } = await call({ path: "/me", teamId: OWN_TEAM_ID, body: {} });

    expect(body.detail).toContain(OWN_TEAM_ID);
  });

  test("lets a personal credential through to validation", async () => {
    const { status, body } = await call({ path: "/me", body: { name: "ok" } });

    expect(status).toBe(200);
    expect(body.name).toBe("ok");
  });
});

describe("team audience", () => {
  test("passes a team credential addressing its own team", async () => {
    const { status } = await call({
      path: `/teams/${OWN_TEAM_ID}`,
      teamId: OWN_TEAM_ID,
      body: { name: "ok" },
    });

    expect(status).toBe(200);
  });

  test("refuses a team credential addressing another team", async () => {
    const { status, body } = await call({
      path: `/teams/${OTHER_TEAM_ID}`,
      teamId: OWN_TEAM_ID,
      body: { name: "ok" },
    });

    expect(status).toBe(403);
    expect(body.code).toBe("FORBIDDEN");
    expect(body.detail).toContain(OWN_TEAM_ID);
  });

  test("leaves a personal credential unrestricted", async () => {
    const { status } = await call({ path: `/teams/${OTHER_TEAM_ID}`, body: { name: "ok" } });

    expect(status).toBe(200);
  });
});

describe("any audience", () => {
  test("admits both credential kinds, leaving the narrowing to the service layer", async () => {
    for (const teamId of [null, OWN_TEAM_ID]) {
      const { status } = await call({ path: "/teams", method: "GET", teamId });

      expect(status).toBe(200);
    }
  });
});

describe("apiOperation", () => {
  test("emits the document metadata first and the guard second", () => {
    const [describe, guard] = apiOperation({
      operationId: "updateTeam",
      summary: "Rename a team",
      scope: TEAM_SCOPE,
      audience: "team",
      responses: OK_RESPONSE,
    });

    expect(readOperationPolicy(describe)).toBeUndefined();
    // The policy the route audits read back off the mounted handler.
    expect(readOperationPolicy(guard)).toEqual({ scope: TEAM_SCOPE, audience: "team" });
  });

  test("a handler that went through no policy declaration reads back as undeclared", () => {
    expect(readOperationPolicy((c: unknown) => c)).toBeUndefined();
    expect(readOperationPolicy("not a handler")).toBeUndefined();
  });
});
