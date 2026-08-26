/// <reference types="@cloudflare/vitest-plugin/types" />

// The generated OpenAPI document is the contract three consumers read: the docs UI, third-party
// clients, and (from Phase 4) the MCP tool derivation. Generation runs the whole Valibot ->
// JSON-Schema conversion, so this suite is also what catches a pipe that has no JSON-Schema
// equivalent silently emptying an operation's schema.
//
// Every expectation derives from the app's own constants and route table, so a fork that
// rebrands, moves the base path, or adds endpoints keeps passing.

import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { beforeAll, expect, test } from "vitest";

import { apiApp } from "@/api";
import { readOperationPolicy } from "@/api/operation";
import {
  API_SECURITY_SCHEME_BEARER,
  API_SECURITY_SCHEME_OAUTH2,
} from "@/api/openapi-document";
import {
  API_OPENAPI_SPEC_PATH,
  API_V1_BASE_PATH,
  API_VERSION,
  SITE_NAME,
  SITE_URL,
} from "@/constants";
import { API_OPERATION_AUDIENCES, AUDIENCE_EXTENSION_KEY } from "@/lib/api/audience";
import { API_SCOPE_NAMES } from "@/lib/api/scopes";

const HTTP_METHODS = ["get", "post", "patch", "put", "delete"] as const;

interface SpecOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  security?: Record<string, string[]>[];
  [AUDIENCE_EXTENSION_KEY]?: unknown;
  responses?: Record<string, unknown>;
  requestBody?: {
    content?: Record<string, { schema?: { properties?: Record<string, unknown> } }>;
  };
}

interface Spec {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers: { url: string }[];
  components: { securitySchemes: Record<string, { type: string }> };
  paths: Record<string, Record<string, SpecOperation>>;
}

let spec: Spec;
let specStatus: number;

function operations(): { path: string; method: string; operation: SpecOperation }[] {
  return Object.entries(spec.paths).flatMap(([path, item]) =>
    HTTP_METHODS.filter((method) => item[method]).map((method) => ({
      path,
      method,
      operation: item[method],
    })),
  );
}

beforeAll(async () => {
  const response = await apiApp.fetch(
    new Request(`https://example.com${API_OPENAPI_SPEC_PATH}`),
    env as Env,
    createExecutionContext(),
  );

  specStatus = response.status;
  spec = await response.json();
});

// The document is the discovery entry point, so it must answer without a credential — every
// other route on the app requires one.
test("the spec is served publicly as OpenAPI 3.1", () => {
  expect(specStatus).toBe(200);
  expect(spec.openapi).toBe("3.1.0");
  expect(spec.info.title).toContain(SITE_NAME);
  expect(spec.info.version).toBe(API_VERSION);
  expect(spec.servers[0].url).toBe(SITE_URL);
});

// `server.url + path` is how a conformant client builds a request URL, and the path keys already
// carry the base path — so a server URL with a path of its own would resolve to /api/v1/api/v1/...
test("the server url joined with a documented path reaches the real endpoint", async () => {
  expect(new URL(spec.servers[0].url).pathname).toBe("/");

  const path = `${API_V1_BASE_PATH}/me`;
  expect(Object.keys(spec.paths)).toContain(path);

  const response = await apiApp.fetch(
    new Request(`${spec.servers[0].url}${path}`),
    env as Env,
    createExecutionContext(),
  );

  // Unauthenticated, so the route answers 401; a 404 would mean the joined URL missed the app.
  expect(response.status).toBe(401);
});

test("both credential types are declared as security schemes", () => {
  const schemes = Object.values(spec.components.securitySchemes).map((scheme) => scheme.type);

  expect(schemes).toContain("http");
  expect(schemes).toContain("oauth2");
});

test("the core resource surface is documented", () => {
  const documented = Object.keys(spec.paths);

  for (const path of [
    "/me",
    "/me/sessions",
    "/me/sessions/{sessionId}",
    "/teams",
    "/teams/{teamId}",
    "/teams/{teamId}/members",
    "/teams/{teamId}/members/{userId}",
    "/teams/{teamId}/invitations",
    "/teams/{teamId}/invitations/{invitationId}",
    "/teams/{teamId}/billing",
    "/api-keys",
    "/api-keys/{keyId}",
  ]) {
    expect(documented).toContain(`${API_V1_BASE_PATH}${path}`);
  }
});

// operationId becomes the MCP tool name in Phase 4: it must exist, be unique, and be stable.
test("every operation has a unique operationId and an agent-readable description", () => {
  const ids = operations()
    .filter(({ path }) => path !== API_OPENAPI_SPEC_PATH)
    .map(({ path, method, operation }) => {
      expect(operation.operationId, `${method} ${path}`).toBeTruthy();
      expect(operation.summary, `${method} ${path}`).toBeTruthy();
      expect((operation.description ?? "").length, `${method} ${path}`).toBeGreaterThan(40);
      return operation.operationId;
    });

  expect(new Set(ids).size).toBe(ids.length);
});

// Phase 4 reads this metadata to hide tools a credential's scopes cannot reach, so an operation
// with no declared scope would leak into every tool list.
test("every operation declares a scope from the catalog for both schemes", () => {
  for (const { path, method, operation } of operations()) {
    if (path === API_OPENAPI_SPEC_PATH) {
      continue;
    }

    const requirements = operation.security ?? [];
    // Never absent: an empty scope list still demands a credential, no security at all is public.
    expect(requirements.length, `${method} ${path}`).toBe(2);

    const declared = new Map<string, string[]>();

    for (const requirement of requirements) {
      // One scheme per requirement: the two are alternatives, not a pair a caller must satisfy.
      const entries = Object.entries(requirement);
      expect(entries.length, `${method} ${path}`).toBe(1);
      declared.set(entries[0][0], entries[0][1]);
    }

    expect([...declared.keys()].sort(), `${method} ${path}`).toEqual(
      [API_SECURITY_SCHEME_BEARER, API_SECURITY_SCHEME_OAUTH2].sort(),
    );

    for (const scopes of declared.values()) {
      expect(scopes.length, `${method} ${path}`).toBeLessThanOrEqual(1);

      if (scopes.length === 1) {
        expect(API_SCOPE_NAMES, `${method} ${path}`).toContain(scopes[0]);
      }
    }

    // Both schemes describe one operation, so a caller must not read a different requirement
    // depending on whether it authenticated with a key or an OAuth token. The whole list is
    // compared, so the unscoped operation has to declare the empty list under both schemes.
    expect(declared.get(API_SECURITY_SCHEME_OAUTH2), `${method} ${path}`).toEqual(
      declared.get(API_SECURITY_SCHEME_BEARER),
    );
  }
});

// An unscoped operation answers a caller whose grant nobody has checked, so it must not be able to
// change anything. This is what keeps `scope: null` from becoming a way to mount an unguarded
// write: introspection is the reason the escape hatch exists, and a GET is all introspection needs.
test("an operation that declares no scope is read-only", () => {
  for (const { path, method, operation } of operations()) {
    if (path === API_OPENAPI_SPEC_PATH) {
      continue;
    }

    const isUnscoped = (operation.security ?? []).some(
      (requirement) => Object.values(requirement).some((scopes) => scopes.length === 0),
    );

    if (isUnscoped) {
      expect(method, `${method} ${path} declares no scope`).toBe("get");
    }
  }
});

// The MCP tool list reads this to hide operations a team credential could never call, so an
// operation that documents no audience would be advertised to a credential that can only 403.
test("every operation documents an audience from the vocabulary", () => {
  for (const { path, method, operation } of operations()) {
    if (path === API_OPENAPI_SPEC_PATH) {
      continue;
    }

    expect(API_OPERATION_AUDIENCES, `${method} ${path}`).toContain(operation[AUDIENCE_EXTENSION_KEY]);
  }
});

// Documented policy and enforced policy come from the single declaration `apiOperation` reads, so a
// mismatch here means a second source of truth crept back in.
test("the scope and audience each operation documents are the ones its mounted guard enforces", () => {
  // Both sides read as null for a null-scope operation, which is the pairing this asserts: an
  // empty documented scope list has to mean an unscoped guard, and nothing else.
  const enforced = new Map<string, { scope: string | null; audience: string }>();

  for (const route of apiApp.routes) {
    const policy = readOperationPolicy(route.handler);
    if (!policy) {
      continue;
    }

    const path = route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    enforced.set(`${route.method.toLowerCase()} ${path}`, policy);
  }

  const documented = operations().filter(({ path }) => path !== API_OPENAPI_SPEC_PATH);

  expect(documented.length).toBe(enforced.size);

  for (const { path, method, operation } of documented) {
    const requirement = operation.security?.[0] ?? {};
    const policy = enforced.get(`${method} ${path}`);

    expect(policy, `${method} ${path} mounts no policy guard`).toBeDefined();
    expect(Object.values(requirement)[0]?.[0] ?? null, `${method} ${path}`).toBe(policy?.scope ?? null);
    expect(operation[AUDIENCE_EXTENSION_KEY], `${method} ${path}`).toBe(policy?.audience);
  }
});

test("every operation documents the shared failure modes", () => {
  for (const { path, method, operation } of operations()) {
    if (path === API_OPENAPI_SPEC_PATH) {
      continue;
    }

    for (const status of ["400", "401", "403", "404", "429"]) {
      expect(Object.keys(operation.responses ?? {}), `${method} ${path}`).toContain(status);
    }
  }
});

// Guards the Valibot -> JSON Schema conversion: a throw or a swallowed error would leave the
// request body an empty object instead of the fields the server actually validates.
test("request bodies keep their converted field schemas", () => {
  const createTeam = spec.paths[`${API_V1_BASE_PATH}/teams`].post;
  const properties = createTeam.requestBody?.content?.["application/json"]?.schema?.properties ?? {};

  expect(Object.keys(properties)).toContain("name");
  expect(Object.keys(properties)).toContain("description");
});
