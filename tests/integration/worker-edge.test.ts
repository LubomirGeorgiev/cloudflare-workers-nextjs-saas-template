/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  API_OPENAPI_SPEC_PATH,
  API_V1_BASE_PATH,
  OAUTH_AUTHORIZE_PATH,
  OAUTH_OPEN_DCR_ENABLED,
  OAUTH_PROTECTED_RESOURCE_PATH,
  OAUTH_REGISTER_PATH,
} from "@/constants";
import { API_SCOPE_NAMES } from "@/lib/api/scopes";
import { __INTERNAL_CF_CONTEXT_FIELDS } from "@/utils/cf-context-fields";
import {
  __INTERNAL_CLIENT_IP_HEADERS_TO_STRIP,
  __INTERNAL_TRUSTED_CLIENT_IP_HEADER,
} from "@/utils/trusted-client-ip";
import { __INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER } from "@/utils/request-protocol";

const innerFetchMock = vi.hoisted(() => vi.fn());

vi.mock("vinext/server/fetch-handler", () => ({
  default: {
    fetch: innerFetchMock,
  },
}));

const { default: worker } = await import("../../worker-entrypoint");

describe("worker edge integration", () => {
  beforeEach(() => {
    innerFetchMock.mockReset();
    innerFetchMock.mockImplementation(async (request: Request) => {
      const headers = Object.fromEntries(
        [
          __INTERNAL_TRUSTED_CLIENT_IP_HEADER,
          __INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER,
          "cf-connecting-ip",
          "x-forwarded-for",
          ...__INTERNAL_CF_CONTEXT_FIELDS.map(({ header }) => header),
        ].map((header) => [header, request.headers.get(header)])
      );

      return Response.json({ headers });
    });
  });

  test("health endpoint short-circuits before the Vinext app handler", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/_worker/health"),
      env as Env,
      createExecutionContext()
    );

    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(innerFetchMock).not.toHaveBeenCalled();
  });

  // The public API now sits behind the OAuth provider, which rejects credential-less requests
  // itself. The invariant under test is unchanged: it never reaches the Next handler.
  test("the public API is routed away from the Vinext app handler", async () => {
    const response = await worker.fetch(
      new Request(`https://example.com${API_V1_BASE_PATH}/me`),
      env as Env,
      createExecutionContext()
    );

    expect(innerFetchMock).not.toHaveBeenCalled();
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      `resource_metadata="https://example.com${OAUTH_PROTECTED_RESOURCE_PATH}${API_V1_BASE_PATH}/me"`,
    );
  });

  // Machine clients need the contract before they have a credential, so this one path is routed
  // to the Hono app ahead of the provider rather than being gated behind a bearer token.
  test("the OpenAPI document stays readable without a credential", async () => {
    const response = await worker.fetch(
      new Request(`https://example.com${API_OPENAPI_SPEC_PATH}`),
      env as Env,
      createExecutionContext()
    );

    expect(innerFetchMock).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  test("the consent page falls through to the Next app handler", async () => {
    await worker.fetch(
      new Request(`https://example.com${OAUTH_AUTHORIZE_PATH}`),
      env as Env,
      createExecutionContext()
    );

    expect(innerFetchMock).toHaveBeenCalledOnce();
  });

  test("authorization server metadata advertises S256-only PKCE", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/.well-known/oauth-authorization-server"),
      env as Env,
      createExecutionContext()
    );
    const metadata = await response.json() as {
      code_challenge_methods_supported: string[];
      registration_endpoint?: string;
      scopes_supported: string[];
    };

    expect(innerFetchMock).not.toHaveBeenCalled();
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
    expect(metadata.scopes_supported).toEqual([...API_SCOPE_NAMES]);
    // Flag-aware: forks that turn the kill-switch off must not advertise an endpoint they
    // do not serve.
    if (OAUTH_OPEN_DCR_ENABLED) {
      expect(metadata.registration_endpoint).toContain(OAUTH_REGISTER_PATH);
    } else {
      expect(metadata.registration_endpoint).toBeUndefined();
    }
  });

  test("all Worker-injected header names use the internal prefix", () => {
    const injectedHeaders = [
      __INTERNAL_TRUSTED_CLIENT_IP_HEADER,
      __INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER,
      ...__INTERNAL_CF_CONTEXT_FIELDS.map(({ header }) => header),
    ];

    expect(injectedHeaders.every((header) => header.startsWith("__INTERNAL"))).toBe(true);
  });

  test("normal requests strip spoofed client headers and forward trusted Cloudflare context", async () => {
    const request = new Request("https://example.com/dashboard", {
      headers: {
        [__INTERNAL_TRUSTED_CLIENT_IP_HEADER]: "192.0.2.10",
        "cf-connecting-ip": "203.0.113.42",
        "x-forwarded-for": "198.51.100.12",
        "__INTERNAL_CF_IPCITY": "Spoofed City",
        "__INTERNAL_CF_IPCOUNTRY": "ZZ",
        "__INTERNAL_CF_ASN": "0",
      },
    });

    Object.defineProperty(request, "cf", {
      configurable: true,
      value: {
        asn: 64512,
        city: "Berlin",
        country: "DE",
        isEUCountry: true,
      },
    });

    const response = await worker.fetch(
      request,
      env as Env,
      createExecutionContext()
    );
    const body = await response.json() as {
      headers: Record<string, string | null>;
    };

    expect(innerFetchMock).toHaveBeenCalledOnce();
    expect(body.headers[__INTERNAL_TRUSTED_CLIENT_IP_HEADER]).toBe("203.0.113.42");
    expect(body.headers[__INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER]).toBe("https");
    expect(body.headers["__INTERNAL_CF_IPCITY"]).toBe("Berlin");
    expect(body.headers["__INTERNAL_CF_IPCOUNTRY"]).toBe("DE");
    expect(body.headers["__INTERNAL_CF_ASN"]).toBe("64512");
    expect(body.headers["__INTERNAL_CF_IS_EU_COUNTRY"]).toBe("true");

    for (const header of __INTERNAL_CLIENT_IP_HEADERS_TO_STRIP) {
      if (header === __INTERNAL_TRUSTED_CLIENT_IP_HEADER) {
        continue;
      }
      expect(body.headers[header] ?? null).toBeNull();
    }
  });

  test("forwards HTTP as the trusted request protocol for local previews", async () => {
    const response = await worker.fetch(
      new Request("http://localhost:8787/sign-in", {
        headers: {
          [__INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER]: "https",
        },
      }),
      env as Env,
      createExecutionContext()
    );
    const body = await response.json() as {
      headers: Record<string, string | null>;
    };

    expect(body.headers[__INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER]).toBe("http");
  });
});
