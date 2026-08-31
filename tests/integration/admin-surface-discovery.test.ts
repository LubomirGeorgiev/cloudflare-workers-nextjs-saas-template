/// <reference types="@cloudflare/vitest-plugin/types" />

// What the internal endpoints tell an unauthenticated client to go and get.

import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { describe, expect, test, vi } from "vitest";

import {
  ADMIN_API_BASE_PATH,
  ADMIN_MCP_PATH,
  API_V1_BASE_PATH,
  MCP_PATH,
  OAUTH_PROTECTED_RESOURCE_PATH,
} from "@/constants";
import { ADMIN_SCOPE_NAMES } from "@/lib/api/admin-scopes";
import { API_SCOPE_NAMES } from "@/lib/api/scopes";

const innerFetchMock = vi.hoisted(() => vi.fn());

vi.mock("vinext/server/fetch-handler", () => ({
  default: { fetch: innerFetchMock },
}));

const { default: worker } = await import("../../worker-entrypoint");

function get(pathname: string): Promise<Response> {
  return worker.fetch(
    new Request(`https://example.com${pathname}`),
    env as Env,
    createExecutionContext(),
  );
}

const INTERNAL_PATHS = [`${ADMIN_API_BASE_PATH}/users`, ADMIN_MCP_PATH];

// The failure this pins: mounted on the OAuth provider, the internal endpoints answered with the
// provider's standard challenge, which names the *public* catalog. A client read that, requested
// those scopes, completed login, and then met a permanent 403 — because a public scope opens
// nothing here. The challenge has to name what these endpoints actually accept.
describe("internal endpoints advertise the internal catalog, never the public one", () => {
  test.each(INTERNAL_PATHS)("%s challenges with the internal scopes", async (pathname) => {
    const response = await get(pathname);
    const challenge = response.headers.get("www-authenticate") ?? "";

    expect(response.status).toBe(401);
    expect(challenge).toContain("resource_metadata");

    for (const scope of ADMIN_SCOPE_NAMES) {
      expect(challenge).toContain(scope);
    }
    for (const scope of API_SCOPE_NAMES) {
      expect(challenge).not.toContain(scope);
    }
  });

  test.each(INTERNAL_PATHS)("%s publishes internal-only resource metadata", async (pathname) => {
    const response = await get(`${OAUTH_PROTECTED_RESOURCE_PATH}${pathname}`);

    expect(response.status).toBe(200);

    const document = (await response.json()) as {
      resource: string;
      scopes_supported: string[];
    };

    expect(document.resource).toContain(pathname);
    expect(document.scopes_supported).toEqual([...ADMIN_SCOPE_NAMES]);
    expect(document.scopes_supported).not.toContain(API_SCOPE_NAMES[0]);
  });
});

// The public surface must keep advertising the public catalog and nothing else. The two documents
// are what keep the catalogs apart at discovery time, so a regression in either direction matters.
describe("the public surface never advertises an internal scope", () => {
  test.each([`${API_V1_BASE_PATH}/me`, MCP_PATH])("%s challenge stays public", async (pathname) => {
    const response = await get(pathname);
    const challenge = response.headers.get("www-authenticate") ?? "";

    expect(response.status).toBe(401);
    expect(challenge).toContain("resource_metadata");

    for (const scope of ADMIN_SCOPE_NAMES) {
      expect(challenge).not.toContain(scope);
    }
  });

  test.each([API_V1_BASE_PATH, MCP_PATH])("%s metadata stays public", async (pathname) => {
    const response = await get(`${OAUTH_PROTECTED_RESOURCE_PATH}${pathname}`);

    expect(response.status).toBe(200);

    const document = (await response.json()) as { scopes_supported: string[] };

    expect(document.scopes_supported).toEqual([...API_SCOPE_NAMES]);
    for (const scope of ADMIN_SCOPE_NAMES) {
      expect(document.scopes_supported).not.toContain(scope);
    }
  });
});
