/// <reference types="@cloudflare/vitest-plugin/types" />

// Structural audits of the *internal* route table, mirroring `api-route-policy.test.ts` for the
// public one. They walk `adminApiApp.routes` and never send a request.
//
// What is under test here is the isolation itself: that every internal operation went through
// `adminOperation` (and therefore mounts `assertAdminPrincipal`), that the internal app publishes
// no document, and — most importantly — that the two route tables never overlap.

import { expect, test } from "vitest";

import { apiApp } from "@/api";
import { adminApiApp } from "@/api/admin";
import { readAdminOperationPolicy } from "@/api/admin/operation";
import { readOperationPolicy } from "@/api/operation";
import { ADMIN_API_BASE_PATH, API_OPENAPI_SPEC_PATH, API_V1_BASE_PATH } from "@/constants";
import { ADMIN_SCOPE_NAMES, isAdminScope } from "@/lib/api/admin-scopes";
import { isApiScope } from "@/lib/api/scopes";

/** Every mounted route that is an operation rather than app-wide middleware. */
function operationRoutes(app: typeof apiApp) {
  return app.routes.filter(
    (route) => route.method !== "ALL" && route.path !== API_OPENAPI_SPEC_PATH,
  );
}

test("every internal operation went through the admin policy declaration", () => {
  const declaredBy = new Map<string, boolean>();

  for (const route of operationRoutes(adminApiApp)) {
    const key = `${route.method} ${route.path}`;
    const declared = readAdminOperationPolicy(route.handler) !== undefined;

    declaredBy.set(key, (declaredBy.get(key) ?? false) || declared);
  }

  expect(declaredBy.size).toBeGreaterThan(0);
  expect([...declaredBy.entries()].filter(([, declared]) => !declared).map(([key]) => key)).toEqual([]);
});

// `adminOperation` takes an `AdminScope`, so a public scope is not even expressible on an internal
// route. Asserted anyway on the values that actually reached the table.
test("every internal operation declares an internal scope and nothing else", () => {
  const scopes = adminApiApp.routes.flatMap((route) => {
    const policy = readAdminOperationPolicy(route.handler);

    return policy ? [policy.scope] : [];
  });

  expect(scopes.length).toBeGreaterThan(0);

  for (const scope of scopes) {
    expect(isAdminScope(scope)).toBe(true);
    expect(isApiScope(scope)).toBe(false);
    expect(ADMIN_SCOPE_NAMES).toContain(scope);
  }
});

// The mirror of the rule above: nothing on the public app may carry an internal scope, and nothing
// on the internal app may be mounted with the public helper.
test("the two route tables never overlap", () => {
  for (const route of apiApp.routes) {
    const policy = readOperationPolicy(route.handler);

    if (policy?.scope) {
      expect(isAdminScope(policy.scope), `${policy.operationId} is public`).toBe(false);
    }

    expect(readAdminOperationPolicy(route.handler)).toBeUndefined();
  }

  for (const route of adminApiApp.routes) {
    expect(readOperationPolicy(route.handler)).toBeUndefined();
  }
});

test("no internal path is mounted on the public app, and vice versa", () => {
  for (const route of operationRoutes(apiApp)) {
    expect(route.path.startsWith(ADMIN_API_BASE_PATH)).toBe(false);
  }

  for (const route of operationRoutes(adminApiApp)) {
    expect(route.path.startsWith(ADMIN_API_BASE_PATH)).toBe(true);
    // `/api/admin/v1` does not start with `/api/v1`, so this also proves the edge prefix routing
    // in `worker-entrypoint.ts` cannot send an internal path to the public app.
    expect(route.path.startsWith(`${API_V1_BASE_PATH}/`)).toBe(false);
  }
});

// The internal document is a build-time artifact read by the admin panel and the internal MCP
// server. Serving it would publish the entire internal surface to anyone who guessed the path.
test("the internal app publishes no discovery document", () => {
  for (const route of adminApiApp.routes) {
    expect(route.path).not.toContain("openapi");
    expect(route.path).not.toContain(".well-known");
  }
});
