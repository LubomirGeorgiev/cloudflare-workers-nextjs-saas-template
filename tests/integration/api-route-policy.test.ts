/// <reference types="@cloudflare/vitest-plugin/types" />

// Structural audits of the API route table. They walk `apiApp.routes`, read the policy each route
// carries, and never send a request; the request behaviour of the same routes lives in
// `api-routes.test.ts`. What is under test here is the table itself — that every mounted operation
// declared a scope and an audience, that the one unscoped operation stays the only one, that the
// scope catalog's `accountOnly` flags still match the routes, and that the guard beats every
// validator.

import { expect, test } from "vitest";

import { apiApp } from "@/api";
import { readOperationPolicy } from "@/api/operation";
import { API_OPENAPI_SPEC_PATH } from "@/constants";
import { isAccountOnlyScope, type ApiScope } from "@/lib/api/scopes";

// Structural, because a route that forgets the declaration is the failure mode this prevents: the
// enumeration is the app's own route table, so a fork that mounts its own router is covered too.
// `apiOperation` is what attaches the policy, so this also proves every route went through it.
test("every mounted operation went through the policy declaration", () => {
  const declaredBy = new Map<string, boolean>();

  for (const route of apiApp.routes) {
    // `ALL` is the app-wide middleware chain (auth, rate limiting); the spec route is public and
    // is deliberately registered before authentication ever runs.
    if (route.method === "ALL" || route.path === API_OPENAPI_SPEC_PATH) {
      continue;
    }

    const key = `${route.method} ${route.path}`;
    // The scope itself is checked against the catalog, and against the document, by the spec suite.
    const declared = readOperationPolicy(route.handler) !== undefined;

    declaredBy.set(key, (declaredBy.get(key) ?? false) || declared);
  }

  expect(declaredBy.size).toBeGreaterThan(0);
  expect([...declaredBy.entries()].filter(([, declared]) => !declared).map(([key]) => key)).toEqual([]);
});

// `scope: null` publishes an operation with an empty scope list and offers it as an MCP tool to
// every credential, a scopeless key included. It exists for credential introspection alone, so a
// second one has to be a deliberate edit of this list, never a forgotten field.
test("credential introspection is the only operation that declares no scope", () => {
  const unscoped = apiApp.routes.flatMap((route) => {
    const policy = readOperationPolicy(route.handler);

    return policy && policy.scope === null ? [{ method: route.method.toLowerCase(), policy }] : [];
  });

  expect([...new Set(unscoped.map(({ policy }) => policy.operationId))]).toEqual(["getCredential"]);

  // A grant nobody checked must never change anything, and must never address another team.
  for (const { method, policy } of unscoped) {
    expect(method, `${policy.operationId} declares no scope`).toBe("get");
    expect(policy.audience, `${policy.operationId} declares no scope`).toBe("any");
  }
});

// `accountOnly` in the scope catalog is a denormalized copy of what the route table says, kept
// there so `createApiKey` can refuse a doomed grant without importing the OpenAPI document into a
// page bundle. This is what stops the copy drifting: add a team route under `profile:read`, or
// make `getTeam` account-level, and the flag has to move with it.
test("every scope's accountOnly flag matches the audiences its routes declare", () => {
  const audiencesByScope = new Map<ApiScope, Set<string>>();

  for (const route of apiApp.routes) {
    const policy = readOperationPolicy(route.handler);

    // A null-scope operation constrains no scope's flag; the audit above covers those separately.
    if (!policy?.scope) {
      continue;
    }

    const audiences = audiencesByScope.get(policy.scope) ?? new Set<string>();
    audiences.add(policy.audience);
    audiencesByScope.set(policy.scope, audiences);
  }

  expect(audiencesByScope.size).toBeGreaterThan(0);

  // A scope a fork has declared but not yet mounted a route for is skipped, not failed: there is
  // no route table to check it against, and either flag would be a guess.
  for (const [scope, audiences] of audiencesByScope) {
    expect(
      isAccountOnlyScope(scope),
      `${scope} opens ${[...audiences].join(", ")} operations`,
    ).toBe([...audiences].every((audience) => audience === "account"));
  }
});

// A team key holding one of these would be granted something no request could ever use.
test("no scope is account-only in the catalog while a team-reachable route opens it", () => {
  const reachableByTeamKey = new Set(
    apiApp.routes.flatMap((route) => {
      const policy = readOperationPolicy(route.handler);

      return policy?.scope && policy.audience !== "account" ? [policy.scope] : [];
    }),
  );

  expect([...reachableByTeamKey].filter(isAccountOnlyScope)).toEqual([]);
});

// The guard must beat every validator, or a credential that may not call the operation at all
// learns its request schema from a 400. Registration order is what decides it, so it is read off
// the route table rather than off the source text.
test("the policy guard is registered ahead of every validator on its route", () => {
  const guardAt = new Map<string, number>();
  const validatorAt = new Map<string, number>();

  apiApp.routes.forEach((route, index) => {
    if (route.method === "ALL" || route.path === API_OPENAPI_SPEC_PATH) {
      return;
    }

    const key = `${route.method} ${route.path}`;
    const at = readOperationPolicy(route.handler) ? guardAt : route.handler.name === "validator" ? validatorAt : null;

    if (at && !at.has(key)) {
      at.set(key, index);
    }
  });

  // hono-openapi names its validator middleware; a rename would blind the check above rather than
  // fail it, so the enumeration itself is asserted to have found some.
  expect(validatorAt.size).toBeGreaterThan(0);

  for (const [key, index] of validatorAt) {
    expect(guardAt.get(key), `${key}: the scope/audience guard runs after a validator`).toBeLessThan(index);
  }
});
