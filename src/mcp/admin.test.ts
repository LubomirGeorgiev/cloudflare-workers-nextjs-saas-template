// The two properties of the internal MCP boundary: any internal scope opens a session, and a
// refusal is a problem+json 4xx rather than the handler's JSON-RPC 500.

import { beforeEach, describe, expect, test, vi } from "vitest";

import { ActionError } from "@/lib/action-error";
import type { ApiPrincipal } from "@/lib/api/principal";

vi.mock("server-only", () => ({}));

// `@/lib/api/errors` reaches the rate limiter, which reaches the Worker runtime bindings.
vi.mock("@/utils/get-IP", () => ({
  getIP: vi.fn(),
}));

vi.mock("@/utils/is-test-mode", () => ({
  isTestMode: () => false,
}));

vi.mock("@/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  resetRateLimit: vi.fn(),
}));

const mcpHandler = vi.fn(() => Promise.resolve(new Response("ok")));

vi.mock("agents/mcp/server", () => ({
  createMcpHandler: () => mcpHandler,
  getMcpAuthContext: () => undefined,
}));

vi.mock("@/api/admin", () => ({ adminApiApp: {} }));
vi.mock("@/api/admin/generated-document", () => ({ adminApiDocument: () => ({}) }));
vi.mock("@/mcp/derived-server", () => ({ buildDerivedMcpServer: vi.fn() }));

const assertAdminPrincipal = vi.fn();
vi.mock("@/lib/admin/admin-principal", () => ({
  assertAdminPrincipal: (params: unknown) => assertAdminPrincipal(params),
}));

const principalFromBearerProps = vi.fn();
vi.mock("@/lib/oauth/bearer-props", () => ({
  principalFromBearerProps: (props: unknown) => principalFromBearerProps(props),
}));

const { adminMcpApiHandler } = await import("@/mcp/admin");

function principalWithScopes(scopes: string[]): ApiPrincipal {
  return {
    kind: "api-key",
    keyId: "key-1",
    userId: "user-1",
    user: {} as ApiPrincipal["user"],
    teams: [],
    scopes: scopes as ApiPrincipal["scopes"],
    audience: { type: "personal" },
  };
}

async function callHandler(props: unknown): Promise<Response> {
  const request = new Request("https://example.test/mcp/admin", { method: "POST" });

  return await adminMcpApiHandler.fetch(
    request,
    {} as Env,
    { props } as unknown as ExecutionContext,
  );
}

describe("adminMcpApiHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertAdminPrincipal.mockResolvedValue(undefined);
  });

  test("a write-only credential opens a session", async () => {
    principalFromBearerProps.mockResolvedValue(principalWithScopes(["admin:write"]));

    const response = await callHandler({ credentialKind: "api-key" });

    expect(assertAdminPrincipal).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "admin:write" }),
    );
    expect(mcpHandler).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });

  test("a credential holding nothing internal is asserted against the read scope", async () => {
    principalFromBearerProps.mockResolvedValue(principalWithScopes(["profile:read"]));

    await callHandler({ credentialKind: "api-key" });

    expect(assertAdminPrincipal).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "admin:read" }),
    );
  });

  test("a refused credential gets a problem+json 403, not the handler", async () => {
    principalFromBearerProps.mockResolvedValue(principalWithScopes(["admin:read"]));
    assertAdminPrincipal.mockRejectedValue(new ActionError("FORBIDDEN", "Not authorized."));

    const response = await callHandler({ credentialKind: "api-key" });

    expect(response.status).toBe(403);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    // The endpoint stays unadvertised: no challenge points a non-admin at it.
    expect(response.headers.get("www-authenticate")).toBeNull();
    expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
    expect(mcpHandler).not.toHaveBeenCalled();
  });

  test("a missing credential gets a 401 rather than a JSON-RPC internal error", async () => {
    principalFromBearerProps.mockResolvedValue(null);

    const response = await callHandler(undefined);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "NOT_AUTHORIZED" });
    expect(mcpHandler).not.toHaveBeenCalled();
  });
});
