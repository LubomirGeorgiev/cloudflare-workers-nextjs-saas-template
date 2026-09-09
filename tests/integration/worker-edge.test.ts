/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { setPagesClientAssets } from "vinext/server/pages-client-assets";

import {
  ACCEPT_VARY_FIELD,
  API_CATALOG_CONTENT_TYPE,
  AUTH_SESSION_PRESENT_COOKIE_NAME,
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
  EDGE_HTML_CACHE_HEADER,
  EDGE_HTML_CACHE_STATUS,
  MARKDOWN_NEGOTIATION_CACHE_CONTROL,
  MARKDOWN_PAGE_CACHE_CONTROL,
  STATIC_API_DOCUMENT_EDGE_CACHE_CONTROL,
} from "@/constants/cache-control";
import { MARKDOWN_PAGE_CACHE_PREFIX } from "@/constants/kv-prefixes";
import { I18N_ENABLED } from "@/constants";
import {
  DEFAULT_LOCALE,
  ENABLED_LOCALES,
  LOCALES,
  LOCALE_COOKIE_NAME,
} from "@/i18n/config";
import { API_SCOPE_NAMES } from "@/lib/api/scopes";
import { purgeEdgeHtmlPages } from "@/lib/edge/edge-html-cache";
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
import proxy from "@/proxy";

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

// The real names are hashed by the client build, which this runner never performs. Seeding the
// same store Vinext writes at startup is what lets the preload assertions below read a known shape.
// It runs before the first request, because the preload list is memoized per isolate.
const BOOTSTRAP_MODULE_URLS = [
  "/_next/static/chunks/framework-0000000000.js",
  "/_next/static/chunks/vinext-0000000000.js",
];

setPagesClientAssets({ appBootstrapPreinitModules: BOOTSTRAP_MODULE_URLS });

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

  // Cloudflare replays these as a 103 Early Hints response, so the browser fetches the
  // render-critical assets while the Worker renders. Matches the shape, never a hashed name.
  test("stamps Early Hints preloads on a rendered HTML page", async () => {
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
    const values = (response.headers.get("link") ?? "").split(", ");

    for (const moduleUrl of BOOTSTRAP_MODULE_URLS) {
      expect(values).toContain(`<${moduleUrl}>; rel="modulepreload"`);
    }
    // The preloads lead, and the discovery relations the page already advertised still follow.
    expect(values.findIndex((value) => value.includes("modulepreload")))
      .toBeLessThan(values.findIndex((value) => value.includes('rel="api-catalog"')));
  });

  test("stamps no preloads on an HTML error page", async () => {
    innerFetchMock.mockImplementationOnce(async () => {
      return new Response("<html></html>", {
        status: 404,
        headers: { "content-type": `${HTML_CONTENT_TYPE}; charset=utf-8` },
      });
    });

    const response = await worker.fetch(
      new Request("https://example.com/dashboard", { headers: { accept: "text/html" } }),
      env as Env,
      createExecutionContext(),
    );
    const link = response.headers.get("link") ?? "";

    expect(link).not.toContain("modulepreload");
    expect(link).toContain('rel="api-catalog"');
  });

  // The default mock answers with JSON, which is what every machine route returns.
  test("stamps no preloads on a non-HTML response", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/dashboard"),
      env as Env,
      createExecutionContext(),
    );

    expect(response.headers.get("link") ?? "").not.toContain("preload");
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

// ---------------------------------------------------------------------------
// Stored public HTML. A warm anonymous page request is answered from `caches.default` under a
// synthetic key, while the visitor's own response keeps the page's `no-store` policy. See
// docs/edge-caching.md; the gate itself lives in `src/lib/edge/edge-html-cache.ts`.
// ---------------------------------------------------------------------------
describe("edge HTML page cache", () => {
  const PAGE_PATH = "/blog";
  const PAGE_HEADERS = { accept: "text/html" } as const;
  const PAGE_CACHE_CONTROL = "private, no-store";
  const PAGE_BODY = "<html><body><main>Blog</main></body></html>";
  // The alternate served locale, so a single-locale fork skips the cases that need two.
  const ALTERNATE_LOCALE = ENABLED_LOCALES.find((locale) => locale !== DEFAULT_LOCALE);

  // Every request shape next-intl's `syncCookie` decides differently. The first carries no locale
  // signal, which is the one shape that gets the cookie, so the negative block below drops it.
  const LOCALE_COOKIE_CASES: ReadonlyArray<[string, Record<string, string>]> = [
    ["carries no locale signal", {}],
    ["already carries the cookie", { cookie: `${LOCALE_COOKIE_NAME}=${DEFAULT_LOCALE}` }],
    ["negotiates the served locale from Accept-Language", { "accept-language": DEFAULT_LOCALE }],
    ["is not a document request", { "sec-fetch-dest": "empty" }],
  ];

  function htmlPageResponse({
    body = PAGE_BODY,
    contentType = `${HTML_CONTENT_TYPE}; charset=utf-8`,
    status = 200,
  }: { body?: string; contentType?: string; status?: number } = {}): Response {
    return new Response(body, {
      status,
      headers: {
        "cache-control": PAGE_CACHE_CONTROL,
        "content-type": contentType,
        "set-cookie": `${LOCALE_COOKIE_NAME}=${DEFAULT_LOCALE}; Path=/`,
      },
    });
  }

  // The same page, but with the `Set-Cookie` the real next-intl middleware writes for this request.
  async function proxiedHtmlPageResponse(request: Request): Promise<Response> {
    const proxied = proxy(new NextRequest(request));
    const headers = new Headers({
      "cache-control": PAGE_CACHE_CONTROL,
      "content-type": `${HTML_CONTENT_TYPE}; charset=utf-8`,
    });

    for (const cookie of proxied.headers.getSetCookie()) {
      headers.append("set-cookie", cookie);
    }

    return new Response(PAGE_BODY, { headers });
  }

  /** The `name=value` pair of each cookie; `src/i18n/routing.test.ts` pins the attributes. */
  function cookiePairs(response: Response): string[] {
    return response.headers.getSetCookie().map((cookie) => cookie.split(";")[0].trim());
  }

  // The put settles through `waitUntil`, so every request the next assertion depends on is drained.
  async function fetchPage(
    pathname: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request(`https://example.com${pathname}`, { headers: PAGE_HEADERS, ...init }),
      env as Env,
      ctx,
    );
    const buffered = new Response(await response.clone().arrayBuffer(), response);

    await waitOnExecutionContext(ctx);

    return buffered;
  }

  function edgeCacheStatus(response: Response): string | null {
    return response.headers.get(EDGE_HTML_CACHE_HEADER);
  }

  beforeEach(async () => {
    // The key carries the build id, which only the Vite build injects.
    vi.stubGlobal("__MARKDOWN_BUILD_ID__", MARKDOWN_BUILD_ID);
    await purgeEdgeHtmlPages({ pathnames: [PAGE_PATH, "/dashboard"] });
    innerFetchMock.mockReset();
    innerFetchMock.mockImplementation(async () => htmlPageResponse());
  });

  test("answers a second anonymous request from the stored copy", async () => {
    const miss = await fetchPage(PAGE_PATH);
    const hit = await fetchPage(PAGE_PATH);

    expect(edgeCacheStatus(miss)).toBe(EDGE_HTML_CACHE_STATUS.MISS);
    expect(edgeCacheStatus(hit)).toBe(EDGE_HTML_CACHE_STATUS.HIT);
    expect(innerFetchMock).toHaveBeenCalledOnce();
    await expect(hit.text()).resolves.toBe(PAGE_BODY);
  });

  // The whole post-processing is inside the stored copy, so an agent or a browser reading a hit
  // sees the discovery relations, the preloads, and the `Vary` a miss carries.
  test("a hit carries the headers a miss carries", async () => {
    const miss = await fetchPage(PAGE_PATH);
    const hit = await fetchPage(PAGE_PATH);

    for (const header of ["cache-control", "content-type", "link", "vary"]) {
      expect(hit.headers.get(header)).toBe(miss.headers.get(header));
    }
    expect(hit.headers.get("cache-control")).toBe(PAGE_CACHE_CONTROL);
  });

  // A hit never runs `src/proxy.ts`, which is what sets the locale cookie on a miss. next-intl
  // writes it only when the request carries none and negotiates nothing else, so a hit does too.
  test("a hit sets the locale cookie for a visitor without one", async () => {
    await fetchPage(PAGE_PATH);
    const hit = await fetchPage(PAGE_PATH);

    expect(edgeCacheStatus(hit)).toBe(EDGE_HTML_CACHE_STATUS.HIT);
    expect(hit.headers.getSetCookie().join(";")).toContain(`${LOCALE_COOKIE_NAME}=`);
  });

  test.each(LOCALE_COOKIE_CASES.filter(([, headers]) => Object.keys(headers).length > 0))(
    "a hit sets no locale cookie when the request %s",
    async (_label, headers) => {
      await fetchPage(PAGE_PATH);
      const hit = await fetchPage(PAGE_PATH, { headers: { ...PAGE_HEADERS, ...headers } });

      expect(edgeCacheStatus(hit)).toBe(EDGE_HTML_CACHE_STATUS.HIT);
      expect(hit.headers.getSetCookie()).toEqual([]);
    },
  );

  // The two tests above pin our own mirror of next-intl's `syncCookie`. This one pins the mirror to
  // next-intl: the miss runs the real `src/proxy.ts`, so an upgrade that changes the rule fails
  // here instead of leaving a hit that writes a cookie the miss would not.
  test.each(LOCALE_COOKIE_CASES)(
    "a hit repeats the locale cookie next-intl writes on a miss when the request %s",
    async (_label, headers) => {
      innerFetchMock.mockImplementation(proxiedHtmlPageResponse);

      const requestInit = { headers: { ...PAGE_HEADERS, ...headers } };
      const miss = await fetchPage(PAGE_PATH, requestInit);
      const hit = await fetchPage(PAGE_PATH, requestInit);

      expect(edgeCacheStatus(miss)).toBe(EDGE_HTML_CACHE_STATUS.MISS);
      expect(edgeCacheStatus(hit)).toBe(EDGE_HTML_CACHE_STATUS.HIT);
      expect(cookiePairs(hit)).toEqual(cookiePairs(miss));
    },
  );

  test("never stores or serves a page for a signed-in visitor", async () => {
    await fetchPage(PAGE_PATH, {
      headers: { ...PAGE_HEADERS, cookie: `${AUTH_SESSION_PRESENT_COOKIE_NAME}=1` },
    });
    const second = await fetchPage(PAGE_PATH);

    expect(innerFetchMock).toHaveBeenCalledTimes(2);
    expect(edgeCacheStatus(second)).toBe(EDGE_HTML_CACHE_STATUS.MISS);
  });

  test("a signed-in request reports a bypass", async () => {
    const response = await fetchPage(PAGE_PATH, {
      headers: { ...PAGE_HEADERS, cookie: `${AUTH_SESSION_PRESENT_COOKIE_NAME}=1` },
    });

    expect(edgeCacheStatus(response)).toBe(EDGE_HTML_CACHE_STATUS.BYPASS);
  });

  // A client-side navigation asks the same URL for a flight payload, so a stored page must not
  // answer it — and its own answer must never be stored under the page's key.
  test("a router request bypasses the stored copy", async () => {
    await fetchPage(PAGE_PATH);
    const rsc = await fetchPage(PAGE_PATH, { headers: { ...PAGE_HEADERS, rsc: "1" } });

    expect(edgeCacheStatus(rsc)).toBe(EDGE_HTML_CACHE_STATUS.BYPASS);
    expect(innerFetchMock).toHaveBeenCalledTimes(2);
  });

  test.each([
    ["a write method", PAGE_PATH, { method: "POST" }],
    ["a query string", `${PAGE_PATH}?page=2`, {}],
    ["a non-public path", "/dashboard", {}],
  ])("stores nothing for %s", async (_label, pathname, init) => {
    await fetchPage(pathname, init);
    const second = await fetchPage(pathname, init);

    expect(innerFetchMock).toHaveBeenCalledTimes(2);
    expect(edgeCacheStatus(second)).not.toBe(EDGE_HTML_CACHE_STATUS.HIT);
  });

  test.each([
    ["a non-200 answer", { status: 404 }],
    ["a non-HTML answer", { contentType: "application/json" }],
  ])("stores nothing for %s", async (_label, overrides) => {
    innerFetchMock.mockImplementation(async () => htmlPageResponse(overrides));

    await fetchPage(PAGE_PATH);
    await fetchPage(PAGE_PATH);

    expect(innerFetchMock).toHaveBeenCalledTimes(2);
  });

  // Under `as-needed` routing the default locale's prefixed URL is a redirect, not a page, so its
  // key must never be written or read.
  test.runIf(I18N_ENABLED)("stores nothing for the default locale's prefixed path", async () => {
    const prefixed = `/${DEFAULT_LOCALE}${PAGE_PATH}`;

    await fetchPage(prefixed);
    await fetchPage(prefixed);

    expect(innerFetchMock).toHaveBeenCalledTimes(2);
  });

  // The bare path is the default locale's page only for a visitor the proxy would not redirect.
  test.runIf(ALTERNATE_LOCALE !== undefined)(
    "bypasses a bare path when the visitor asks for another locale",
    async () => {
      await fetchPage(PAGE_PATH);
      const negotiated = await fetchPage(PAGE_PATH, {
        headers: { ...PAGE_HEADERS, "accept-language": `${ALTERNATE_LOCALE},en;q=0.5` },
      });

      expect(edgeCacheStatus(negotiated)).toBe(EDGE_HTML_CACHE_STATUS.BYPASS);
      expect(innerFetchMock).toHaveBeenCalledTimes(2);
    },
  );

  test.runIf(ALTERNATE_LOCALE !== undefined)(
    "a locale cookie that names another locale hands a bare path back to the proxy",
    async () => {
      await fetchPage(PAGE_PATH);
      const withCookie = await fetchPage(PAGE_PATH, {
        headers: { ...PAGE_HEADERS, cookie: `${LOCALE_COOKIE_NAME}=${ALTERNATE_LOCALE}` },
      });

      expect(edgeCacheStatus(withCookie)).toBe(EDGE_HTML_CACHE_STATUS.BYPASS);
      expect(innerFetchMock).toHaveBeenCalledTimes(2);
    },
  );

  test.runIf(ALTERNATE_LOCALE !== undefined)(
    "a publish purge drops the stored copy of every served locale",
    async () => {
      const alternatePath = `/${ALTERNATE_LOCALE}${PAGE_PATH}`;

      await fetchPage(PAGE_PATH);
      await fetchPage(alternatePath);
      expect(edgeCacheStatus(await fetchPage(PAGE_PATH))).toBe(EDGE_HTML_CACHE_STATUS.HIT);
      expect(edgeCacheStatus(await fetchPage(alternatePath))).toBe(EDGE_HTML_CACHE_STATUS.HIT);

      await purgeEdgeHtmlPages({ pathnames: [PAGE_PATH] });

      expect(edgeCacheStatus(await fetchPage(PAGE_PATH))).toBe(EDGE_HTML_CACHE_STATUS.MISS);
      expect(edgeCacheStatus(await fetchPage(alternatePath))).toBe(EDGE_HTML_CACHE_STATUS.MISS);
    },
  );
});
