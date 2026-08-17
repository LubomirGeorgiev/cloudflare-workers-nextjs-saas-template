/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  API_OPENAPI_SPEC_METHODS,
  API_OPENAPI_SPEC_PATH,
  API_V1_BASE_PATH,
  OAUTH_AUTHORIZE_PATH,
  OAUTH_OPEN_DCR_ENABLED,
  OAUTH_PROTECTED_RESOURCE_PATH,
  OAUTH_REGISTER_PATH,
  SITE_NAME,
} from "@/constants";
import { MARKDOWN_PAGE_CACHE_CONTROL } from "@/constants/cache-control";
import { MARKDOWN_PAGE_CACHE_PREFIX } from "@/constants/kv-prefixes";
import { API_SCOPE_NAMES } from "@/lib/api/scopes";
import {
  MARKDOWN_UNAVAILABLE_CODE,
  MARKDOWN_UNAVAILABLE_STATUS,
} from "@/lib/markdown-pages/serve-page";
import { __INTERNAL_CF_CONTEXT_FIELDS, decodeCfHeaderValue } from "@/utils/cf-context-fields";
import {
  __INTERNAL_CLIENT_IP_HEADERS_TO_STRIP,
  __INTERNAL_TRUSTED_CLIENT_IP_HEADER,
} from "@/utils/trusted-client-ip";
import { __INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER } from "@/utils/request-protocol";

const innerFetchMock = vi.hoisted(() => vi.fn());

// The Vite `define` that injects this is not applied under the test config, so the test supplies
// the value the way `src/lib/scheduler/admin.test.ts` supplies the scheduler queue name.
const MARKDOWN_BUILD_ID = "test-build-id";

vi.mock("vinext/server/fetch-handler", () => ({
  default: {
    fetch: innerFetchMock,
  },
}));

const { default: worker } = await import("../../worker-entrypoint");

describe("worker edge integration", () => {
  beforeEach(() => {
    vi.stubGlobal("__MARKDOWN_BUILD_ID__", MARKDOWN_BUILD_ID);
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

  afterEach(() => {
    vi.unstubAllGlobals();
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

  test("forwards a CMS .md URL to the Markdown route without a redirect", async () => {
    innerFetchMock.mockImplementationOnce(async (request: Request) => {
      return new Response(`# ${new URL(request.url).pathname}\n`, {
        headers: { "content-type": "text/markdown; charset=utf-8" },
      });
    });

    const response = await worker.fetch(
      new Request("https://example.com/docs/core-concepts/billing.md"),
      env as Env,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    await expect(response.text()).resolves.toBe("# /markdown/docs/core-concepts/billing\n");
  });

  test("renders a public JSX page as Markdown and caches it in KV", async () => {
    // Derived, not literal: the key space and the build id are the two things under test.
    const cacheKey = `${MARKDOWN_PAGE_CACHE_PREFIX}${MARKDOWN_BUILD_ID}:/terms`;
    await env.NEXT_INC_CACHE_KV.delete(cacheKey);
    innerFetchMock.mockImplementationOnce(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe("/terms");
      expect(request.headers.get("accept-language")).toBe("en");
      expect(request.headers.get("cookie")).toBeNull();
      return new Response(
        `<html><head><title>Terms - ${SITE_NAME}</title><meta name="description" content="Terms summary"></head><body><main><h1>Terms</h1><p>Page body</p></main></body></html>`,
        {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cdn-cache-control": "max-age=86400, stale-while-revalidate=60",
          },
        },
      );
    });

    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request("https://example.com/terms.md"),
      env as Env,
      ctx,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    // Our own TTL, not the page's: the rendered page above advertises a different CDN max-age.
    expect(response.headers.get("cache-control")).toBe(MARKDOWN_PAGE_CACHE_CONTROL);

    const body = await response.text();
    expect(body.split("\n")[0]).toBe("# Terms");
    expect(body).toContain("Page body");

    // The KV write is now a `waitUntil` task, so it settles after the response.
    await waitOnExecutionContext(ctx);
    expect(await env.NEXT_INC_CACHE_KV.get(cacheKey)).not.toBeNull();
  });

  // A `.md` URL promises Markdown. A page the converter cannot frame still rendered, so it is
  // neither a 500 nor a 404: it is a 406, and HTML must never leave under this URL.
  test("answers 406 with a problem document when the page cannot be converted", async () => {
    const cacheKey = `${MARKDOWN_PAGE_CACHE_PREFIX}${MARKDOWN_BUILD_ID}:/privacy`;
    await env.NEXT_INC_CACHE_KV.delete(cacheKey);
    const html = "<html><head><title>Privacy</title></head><body><p>No main element</p></body></html>";
    innerFetchMock.mockImplementationOnce(async () => {
      return new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    });

    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request("https://example.com/privacy.md"),
      env as Env,
      ctx,
    );

    expect(response.status).toBe(MARKDOWN_UNAVAILABLE_STATUS);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    // The next deploy may convert the same page, so no shared cache may keep the refusal.
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await response.json() as { code: string; status: number };
    expect(body.code).toBe(MARKDOWN_UNAVAILABLE_CODE);
    expect(body.status).toBe(MARKDOWN_UNAVAILABLE_STATUS);

    await waitOnExecutionContext(ctx);
    expect(await env.NEXT_INC_CACHE_KV.get(cacheKey)).toBeNull();
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

  // Machine clients need the contract before they have a credential, so the safe methods on this
  // one path are answered at the edge rather than being gated behind a bearer token.
  test.each([...API_OPENAPI_SPEC_METHODS])(
    "the OpenAPI document stays readable without a credential (%s)",
    async (method) => {
      const response = await worker.fetch(
        new Request(`https://example.com${API_OPENAPI_SPEC_PATH}`, { method }),
        env as Env,
        createExecutionContext()
      );

      expect(innerFetchMock).not.toHaveBeenCalled();
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/json");
    },
  );

  // The fast path must not widen the method contract the canonical Hono route publishes: anything
  // it does not serve falls through to the provider's bearer check, exactly as before.
  test("a write method on the OpenAPI path falls through to the credential check", async () => {
    const response = await worker.fetch(
      new Request(`https://example.com${API_OPENAPI_SPEC_PATH}`, { method: "POST" }),
      env as Env,
      createExecutionContext()
    );

    expect(innerFetchMock).not.toHaveBeenCalled();
    expect(response.status).toBe(401);
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

  test("non-ASCII Cloudflare context values forward as ASCII and decode back", async () => {
    const city = "São Francisco de Assis";
    const request = new Request("https://example.com/sign-up");

    Object.defineProperty(request, "cf", {
      configurable: true,
      value: { city, timezone: "America/Sao_Paulo" },
    });

    const response = await worker.fetch(
      request,
      env as Env,
      createExecutionContext()
    );
    const body = await response.json() as {
      headers: Record<string, string | null>;
    };

    const forwarded = body.headers["__INTERNAL_CF_IPCITY"] ?? "";
    expect([...forwarded].every((char) => char.charCodeAt(0) < 128)).toBe(true);
    expect(decodeCfHeaderValue(forwarded)).toBe(city);
    expect(decodeCfHeaderValue(body.headers["__INTERNAL_CF_TIMEZONE"] ?? "")).toBe(
      "America/Sao_Paulo"
    );
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
