/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  ACCEPT_VARY_FIELD,
  API_CATALOG_CONTENT_TYPE,
  API_CATALOG_METHODS,
  API_CATALOG_PATH,
  API_OPENAPI_SPEC_METHODS,
  API_OPENAPI_SPEC_PATH,
  API_V1_BASE_PATH,
  HTML_CONTENT_TYPE,
  MARKDOWN_CONTENT_TYPE,
  MARKDOWN_EXTENSION,
  OAUTH_AUTHORIZE_PATH,
  OAUTH_OPEN_DCR_ENABLED,
  OAUTH_PROTECTED_RESOURCE_PATH,
  OAUTH_REGISTER_PATH,
  SITE_NAME,
} from "@/constants";
import {
  MARKDOWN_NEGOTIATION_CACHE_CONTROL,
  MARKDOWN_PAGE_CACHE_CONTROL,
  STATIC_API_DOCUMENT_EDGE_CACHE_CONTROL,
} from "@/constants/cache-control";
import { MARKDOWN_PAGE_CACHE_PREFIX } from "@/constants/kv-prefixes";
import { I18N_ENABLED } from "@/constants";
import { LOCALES, LOCALE_COOKIE_NAME } from "@/i18n/config";
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
const SOURCE_CACHE_TAG = "static-terms,_N_T_/terms";

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

  // The card route is the one place next-intl's locale cookie must not reach the response: a
  // `Set-Cookie` keeps the card out of Workers Caching, and a crawler never sends it back anyway.
  test("strips the locale cookie from an OpenGraph card fetched by a crawler", async () => {
    innerFetchMock.mockImplementationOnce(async () =>
      new Response("png", {
        headers: {
          "content-type": "image/png",
          "set-cookie": `${LOCALE_COOKIE_NAME}=en; Path=/`,
        },
      }),
    );

    const response = await worker.fetch(
      new Request("https://example.com/blog/opengraph-image", { headers: { accept: "image/*" } }),
      env as Env,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(response.headers.get("content-type")).toBe("image/png");
  });

  test("keeps the locale cookie on a card-shaped path that a browser navigates to", async () => {
    innerFetchMock.mockImplementationOnce(async () =>
      new Response("<html></html>", {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "set-cookie": `${LOCALE_COOKIE_NAME}=en; Path=/`,
        },
      }),
    );

    const response = await worker.fetch(
      new Request("https://example.com/blog/opengraph-image", { headers: { accept: "text/html" } }),
      env as Env,
      createExecutionContext(),
    );

    expect(response.headers.getSetCookie()).toEqual([`${LOCALE_COOKIE_NAME}=en; Path=/`]);
  });

  // Flag-aware pair: with i18n on, a prefixed path is the app's to route; with it off, the edge
  // collapses the prefix before anything else runs.
  test.runIf(I18N_ENABLED)("passes a locale-prefixed page path through to the app", async () => {
    const [locale] = LOCALES;
    const response = await worker.fetch(
      new Request(`https://example.com/${locale}/blog`),
      env as Env,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(innerFetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(innerFetchMock.mock.calls[0][0].url).pathname).toBe(`/${locale}/blog`);
  });

  test.runIf(!I18N_ENABLED)("collapses a locale-prefixed page path to the bare path", async () => {
    const [locale] = LOCALES;
    const response = await worker.fetch(
      new Request(`https://example.com/${locale}/blog?page=2`, { redirect: "manual" }),
      env as Env,
      createExecutionContext(),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.com/blog?page=2");
    expect(innerFetchMock).not.toHaveBeenCalled();
  });

  test("forwards a CMS .md URL to the Markdown route without a redirect", async () => {
    innerFetchMock.mockImplementationOnce(async (request: Request) => {
      return new Response(`# ${new URL(request.url).pathname}\n`, {
        headers: {
          "cache-tag": "cms-entry-docs-billing",
          "content-type": "text/markdown; charset=utf-8",
        },
      });
    });

    const response = await worker.fetch(
      new Request("https://example.com/docs/core-concepts/billing.md"),
      env as Env,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-tag")).toBe("cms-entry-docs-billing");
    expect(response.headers.get("location")).toBeNull();
    await expect(response.text()).resolves.toBe("# /markdown/docs/core-concepts/billing\n");
  });

  test("redirects an Accept: text/markdown page request to its .md twin", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/terms", { headers: { accept: MARKDOWN_CONTENT_TYPE } }),
      env as Env,
      createExecutionContext(),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/terms${MARKDOWN_EXTENSION}`);
    expect(response.headers.get("vary")).toBe("accept");
    expect(response.headers.get("cache-control")).toBe(MARKDOWN_NEGOTIATION_CACHE_CONTROL);
    // The whole point of answering at the edge: the agent never pays for an HTML render.
    expect(innerFetchMock).not.toHaveBeenCalled();
  });

  // A media type is case-insensitive, so the cheap prefilter in the Worker entry must accept a
  // mixed-case header. A prefilter that is narrower than the parser hides the whole feature.
  test("redirects a mixed-case Accept: text/markdown page request to its .md twin", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/terms", {
        headers: { accept: MARKDOWN_CONTENT_TYPE.toUpperCase() },
      }),
      env as Env,
      createExecutionContext(),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/terms${MARKDOWN_EXTENSION}`);
    expect(innerFetchMock).not.toHaveBeenCalled();
  });

  // A browser header names no exact `text/markdown` range, so it takes the page.
  test("renders the page for a browser Accept header", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/terms", {
        headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
      }),
      env as Env,
      createExecutionContext(),
    );

    expect(response.headers.get("location")).toBeNull();
    expect(innerFetchMock).toHaveBeenCalledOnce();
  });

  test("stamps Vary: accept on HTML for a page with a Markdown twin", async () => {
    innerFetchMock.mockImplementationOnce(async () => {
      return new Response("<html></html>", {
        headers: {
          "content-type": `${HTML_CONTENT_TYPE}; charset=utf-8`,
          vary: "RSC, Next-Url",
        },
      });
    });

    const response = await worker.fetch(
      new Request("https://example.com/terms", { headers: { accept: "text/html" } }),
      env as Env,
      createExecutionContext(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("vary")).toBe(`RSC, Next-Url, ${ACCEPT_VARY_FIELD}`);
  });

  test("does not stamp Vary: accept on HTML with no Markdown twin", async () => {
    innerFetchMock.mockImplementationOnce(async () => {
      return new Response("<html></html>", {
        headers: { "content-type": `${HTML_CONTENT_TYPE}; charset=utf-8` },
      });
    });

    const response = await worker.fetch(
      new Request("https://example.com/dashboard", { headers: { accept: "text/html" } }),
      env as Env,
      createExecutionContext(),
    );

    expect(response.headers.get("vary")).toBeNull();
  });

  test("renders the page for a path with no .md twin", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/dashboard", {
        headers: { accept: MARKDOWN_CONTENT_TYPE },
      }),
      env as Env,
      createExecutionContext(),
    );

    expect(response.headers.get("location")).toBeNull();
    expect(innerFetchMock).toHaveBeenCalledOnce();
  });

  test("renders a public JSX page as Markdown and caches it in KV", async () => {
    // Derived, not literal: the key space and the build id are the two things under test.
    const cacheKey = `${MARKDOWN_PAGE_CACHE_PREFIX}${MARKDOWN_BUILD_ID}:/terms`;
    await env.KV_STORE.delete(cacheKey);
    innerFetchMock.mockImplementationOnce(async (request: Request) => {
      expect(new URL(request.url).pathname).toBe("/terms");
      expect(request.headers.get("accept-language")).toBe("en");
      expect(request.headers.get("cookie")).toBeNull();
      return new Response(
        `<html><head><title>Terms - ${SITE_NAME}</title><meta name="description" content="Terms summary"></head><body><main><h1>Terms</h1><p>Page body</p></main></body></html>`,
        {
          headers: {
            "cache-tag": SOURCE_CACHE_TAG,
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
    expect(response.headers.get("cache-tag")).toBe(SOURCE_CACHE_TAG);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    // Our own TTL, not the page's: the rendered page above advertises a different CDN max-age.
    expect(response.headers.get("cache-control")).toBe(MARKDOWN_PAGE_CACHE_CONTROL);

    const body = await response.text();
    expect(body.split("\n")[0]).toBe("# Terms");
    expect(body).toContain("Page body");

    // The KV write is now a `waitUntil` task, so it settles after the response.
    await waitOnExecutionContext(ctx);
    expect(await env.KV_STORE.get(cacheKey)).not.toBeNull();

    const cachedResponse = await worker.fetch(
      new Request("https://example.com/terms.md"),
      env as Env,
      createExecutionContext(),
    );
    expect(cachedResponse.headers.get("cache-tag")).toBe(SOURCE_CACHE_TAG);
    await expect(cachedResponse.text()).resolves.toContain("Page body");
    expect(innerFetchMock).toHaveBeenCalledOnce();
  });

  // A `.md` URL promises Markdown. A page the converter cannot frame still rendered, so it is
  // neither a 500 nor a 404: it is a 406, and HTML must never leave under this URL.
  test("answers 406 with a problem document when the page cannot be converted", async () => {
    const cacheKey = `${MARKDOWN_PAGE_CACHE_PREFIX}${MARKDOWN_BUILD_ID}:/privacy`;
    await env.KV_STORE.delete(cacheKey);
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
    expect(await env.KV_STORE.get(cacheKey)).toBeNull();
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

  // RFC 9727 discovery: an agent that knows only the origin reads this before it has a credential,
  // so it is answered at the edge on the same terms as the document above. The linkset content is
  // the producer's contract, so `src/lib/api/api-catalog.test.ts` owns it, not this layer.
  test.each([...API_CATALOG_METHODS])(
    "the API catalog answers at the edge without a credential (%s)",
    async (method) => {
      const response = await worker.fetch(
        new Request(`https://example.com${API_CATALOG_PATH}`, { method }),
        env as Env,
        createExecutionContext()
      );

      expect(innerFetchMock).not.toHaveBeenCalled();
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(API_CATALOG_CONTENT_TYPE);
    },
  );

  test("a write method on the API catalog path falls through to the Next app handler", async () => {
    const response = await worker.fetch(
      new Request(`https://example.com${API_CATALOG_PATH}`, { method: "POST" }),
      env as Env,
      createExecutionContext()
    );

    expect(innerFetchMock).toHaveBeenCalledOnce();
    // The app answers (the stub here, a 404 in production). The catalog bytes must never leave
    // under a method the edge does not serve.
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).not.toBe(API_CATALOG_CONTENT_TYPE);
  });

  // The early return happens before `withMetadataRouteEdgeCache`, so the policy each producer
  // stamps is the only one a shared cache ever sees.
  test.each([API_CATALOG_PATH, API_OPENAPI_SPEC_PATH])(
    "the early edge return keeps the deploy-only cache policy (%s)",
    async (pathname) => {
      const response = await worker.fetch(
        new Request(`https://example.com${pathname}`),
        env as Env,
        createExecutionContext()
      );

      expect(response.headers.get("cdn-cache-control")).toBe(
        STATIC_API_DOCUMENT_EDGE_CACHE_CONTROL,
      );
    },
  );

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
