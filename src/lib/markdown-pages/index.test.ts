import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { SITE_NAME } from "@/constants";
import {
  MARKDOWN_PAGE_CACHE_CONTROL,
  MARKDOWN_PAGE_CACHE_TTL_SECONDS,
} from "@/constants/cache-control";
import { MARKDOWN_PAGE_CACHE_PREFIX } from "@/constants/kv-prefixes";
import { INDEXED_DOCS_ROUTES } from "@/constants/docs-routes";
import { BLOG_LISTING_ROUTES, STATIC_PUBLIC_ROUTES } from "@/constants/public-routes";
import { DEFAULT_LOCALE, ENABLED_LOCALES, LOCALES } from "@/i18n/config";
import { __INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER } from "@/utils/request-protocol";

import { LLMS_DESCRIBED_BY_LINK } from "./discovery-links";
import {
  handleMarkdownRequest,
  MARKDOWN_DOWNLOAD_PARAM,
  resolveMdRequestTarget,
} from "./index";
import { buildAbsoluteSourcePageUrl, buildMarkdownPagePath } from "./page-paths";
import { MARKDOWN_UNAVAILABLE_CODE, MARKDOWN_UNAVAILABLE_STATUS } from "./serve-page";

// The Vite `define` that injects the build id is not applied under the unit test config.
const MARKDOWN_BUILD_ID = "test-build-id";

// Derived, not literal: a fork renames its public pages, so the test follows the allowlist.
const PAGE_PATHNAME = STATIC_PUBLIC_ROUTES[0]!.pathname;
const DOCS_PAGE_PATHNAME = INDEXED_DOCS_ROUTES[0]!.pathname;
const BLOG_LISTING_PATHNAME = BLOG_LISTING_ROUTES[0]!.pathname;
const TAG_PAGE_PATHNAME = `${BLOG_LISTING_PATHNAME}/tags/react`;
const SOURCE_CACHE_TAG = "cms-collection-blog,_N_T_/blog";

// A locale the router actually serves, and one the catalog holds but `I18N_ENABLED` de-served.
const SERVED_LOCALE = ENABLED_LOCALES.find((locale) => locale !== DEFAULT_LOCALE);
const DE_SERVED_LOCALE = LOCALES.find((locale) => !ENABLED_LOCALES.includes(locale));
const NON_DEFAULT_CATALOG_LOCALE = LOCALES.find((locale) => locale !== DEFAULT_LOCALE);

// A KV stand-in that stores strings and honors the `"json"` read type, because the page cache
// writes a JSON envelope and reads it back parsed.
function createKvMock() {
  const values = new Map<string, string>();

  return {
    get: vi.fn(async (key: string, type?: "json") => {
      const value = values.get(key) ?? null;

      return value !== null && type === "json" ? JSON.parse(value) : value;
    }),
    put: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
  };
}

describe("resolveMdRequestTarget", () => {
  test("maps CMS, static docs, listing, and index paths", () => {
    expect(resolveMdRequestTarget("/docs/core-concepts/billing.md")).toEqual({
      type: "cms",
      collection: "docs",
      locale: DEFAULT_LOCALE,
      path: "core-concepts/billing",
    });
    expect(resolveMdRequestTarget(`${BLOG_LISTING_PATHNAME}/launch.md`)).toEqual({
      type: "cms",
      collection: "blog",
      locale: DEFAULT_LOCALE,
      path: "launch",
    });
    expect(resolveMdRequestTarget(`${DOCS_PAGE_PATHNAME}.md`)).toEqual({
      type: "page",
      pathname: DOCS_PAGE_PATHNAME,
    });
    expect(resolveMdRequestTarget(`${TAG_PAGE_PATHNAME}.md`)).toEqual({
      type: "page",
      pathname: TAG_PAGE_PATHNAME,
    });
    expect(resolveMdRequestTarget(`${BLOG_LISTING_PATHNAME}.md`)).toEqual({
      type: "page",
      pathname: BLOG_LISTING_PATHNAME,
    });
    expect(resolveMdRequestTarget("/index.md")).toEqual({
      type: "page",
      pathname: "/",
    });
    expect(resolveMdRequestTarget("/dashboard.md")).toBeNull();
  });

  test.skipIf(!SERVED_LOCALE)("maps a served locale prefix, root included", () => {
    const locale = SERVED_LOCALE!;

    expect(resolveMdRequestTarget(`/${locale}${DOCS_PAGE_PATHNAME}.md`)).toEqual({
      type: "page",
      pathname: `/${locale}${DOCS_PAGE_PATHNAME}`,
    });
    expect(resolveMdRequestTarget(`/${locale}${TAG_PAGE_PATHNAME}.md`)).toEqual({
      type: "page",
      pathname: `/${locale}${TAG_PAGE_PATHNAME}`,
    });
    // The locale root, in the form `buildMarkdownPagePath` mints for it.
    expect(resolveMdRequestTarget(buildMarkdownPagePath({ pathname: `/${locale}` }))).toEqual({
      type: "page",
      pathname: `/${locale}`,
    });
    // `/<locale>.md` is not that form, and nothing may resolve it.
    expect(resolveMdRequestTarget(`/${locale}.md`)).toBeNull();
  });

  // Routing follows the served set, so a de-served prefix must not reach a page the router dropped.
  test.skipIf(!DE_SERVED_LOCALE)("rejects a locale the app no longer serves", () => {
    const locale = DE_SERVED_LOCALE!;

    expect(resolveMdRequestTarget(`/${locale}${DOCS_PAGE_PATHNAME}.md`)).toBeNull();
    expect(resolveMdRequestTarget(`/${locale}/index.md`)).toBeNull();
  });

  // The same rule with the flag actually off, so the template's own configuration still proves it.
  test.skipIf(!NON_DEFAULT_CATALOG_LOCALE)("drops every locale prefix when i18n is off", async () => {
    const locale = NON_DEFAULT_CATALOG_LOCALE!;

    vi.resetModules();
    vi.doMock("@/constants", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/constants")>()),
      I18N_ENABLED: false,
    }));

    const disabled = await import("./resolve-target");

    expect(disabled.resolveMdRequestTarget(`/${locale}${DOCS_PAGE_PATHNAME}.md`)).toBeNull();
    expect(disabled.resolveMdRequestTarget(`/${locale}/index.md`)).toBeNull();
    // The default locale keeps its bare paths, so the surface itself still works.
    expect(disabled.resolveMdRequestTarget(`${DOCS_PAGE_PATHNAME}.md`)).toEqual({
      type: "page",
      pathname: DOCS_PAGE_PATHNAME,
    });

    vi.doUnmock("@/constants");
    vi.resetModules();
  });
});

describe("handleMarkdownRequest", () => {
  beforeEach(() => {
    vi.stubGlobal("__MARKDOWN_BUILD_ID__", MARKDOWN_BUILD_ID);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // The TTL is ours, not the page's: the rendered page below advertises a different CDN max-age,
  // and it must not reach either the outgoing header or the KV expiry.
  test("renders and caches an allowlisted public page with the fixed page TTL", async () => {
    const kv = createKvMock();
    // The root layout stamps every title through `%s - SITE_NAME`, so the fixture carries it too.
    const render = vi.fn(async () => new Response(
      `<html><head><title>Terms - ${SITE_NAME}</title><meta name="description" content="Terms summary"></head><body><main><h1>Terms</h1><p>Body</p></main></body></html>`,
      {
        headers: {
          "cache-tag": SOURCE_CACHE_TAG,
          "content-type": "text/html; charset=utf-8",
          "cdn-cache-control": "max-age=86400, stale-while-revalidate=60",
        },
      },
    ));
    const pending: Array<Promise<unknown>> = [];
    const params = {
      request: new Request(
        `https://example.com${buildMarkdownPagePath({ pathname: PAGE_PATHNAME })}`,
      ),
      env: { NEXT_INC_CACHE_KV: kv } as unknown as Env,
      ctx: {
        waitUntil: (promise: Promise<unknown>) => {
          pending.push(promise);
        },
      } as unknown as ExecutionContext,
      render,
    };

    const first = await handleMarkdownRequest(params);
    // The KV write is a `waitUntil` task, so it must settle before the cached read below.
    await Promise.all(pending);
    const second = await handleMarkdownRequest(params);

    expect(first?.headers.get("cache-control")).toBe(MARKDOWN_PAGE_CACHE_CONTROL);
    expect(second?.headers.get("cache-control")).toBe(MARKDOWN_PAGE_CACHE_CONTROL);
    expect(first?.headers.get("cache-tag")).toBe(SOURCE_CACHE_TAG);
    expect(second?.headers.get("cache-tag")).toBe(SOURCE_CACHE_TAG);
    expect(first?.headers.get("link")).toBe(LLMS_DESCRIBED_BY_LINK);
    expect(second?.headers.get("link")).toBe(LLMS_DESCRIBED_BY_LINK);
    await expect(first?.text()).resolves.toContain(
      `Source: ${buildAbsoluteSourcePageUrl({ pathname: PAGE_PATHNAME })}`,
    );
    expect(render).toHaveBeenCalledOnce();
    expect(kv.put).toHaveBeenCalledWith(
      `${MARKDOWN_PAGE_CACHE_PREFIX}${MARKDOWN_BUILD_ID}:${PAGE_PATHNAME}`,
      expect.stringContaining(`"cacheTag":"${SOURCE_CACHE_TAG}"`),
      { expirationTtl: MARKDOWN_PAGE_CACHE_TTL_SECONDS },
    );
  });

  // The page Markdown cache key is pathname-only, so the render must not be able to vary by a
  // caller header: only a fixed set reaches it.
  test("renders the page from a fixed header set, not the caller's", async () => {
    const kv = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
    };
    let renderedHeaders: Headers | null = null;
    const render = vi.fn(async (request: Request) => {
      renderedHeaders = request.headers;
      return new Response(
        `<html><head><title>Home - ${SITE_NAME}</title></head><body><main><h1>Home</h1><p>Body</p></main></body></html>`,
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    });

    await handleMarkdownRequest({
      request: new Request(
        `https://example.com${buildMarkdownPagePath({ pathname: PAGE_PATHNAME })}`,
        {
          headers: {
            [__INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER]: "https",
            "accept-encoding": "br",
            "accept-language": "de-DE",
            authorization: "Bearer token",
            cookie: "session=1",
            "user-agent": "test-agent",
          },
        },
      ),
      env: { NEXT_INC_CACHE_KV: kv } as unknown as Env,
      ctx: { waitUntil: () => undefined } as unknown as ExecutionContext,
      render,
    });

    const headers = renderedHeaders!;
    expect(headers.get("accept")).toBe("text/html");
    expect(headers.get("accept-language")).toBe(DEFAULT_LOCALE);
    // Worker-set and derived from the URL, so it is the same for every caller: it may pass through.
    expect(headers.get(__INTERNAL_TRUSTED_REQUEST_PROTOCOL_HEADER)).toBe("https");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("user-agent")).toBeNull();
    expect(headers.get("accept-encoding")).toBeNull();
  });

  test("attaches a page .md only when the download flag is present", async () => {
    const kv = createKvMock();
    const render = vi.fn(async () => new Response(
      `<html><head><title>React - ${SITE_NAME}</title></head><body><main><h1>React</h1><p>Body</p></main></body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    ));
    const pending: Array<Promise<unknown>> = [];
    const sharedParams = {
      env: { NEXT_INC_CACHE_KV: kv } as unknown as Env,
      ctx: {
        waitUntil: (promise: Promise<unknown>) => {
          pending.push(promise);
        },
      } as unknown as ExecutionContext,
      render,
    };
    const pathname = `${BLOG_LISTING_ROUTES[0]!.pathname}/tags/react`;

    const plain = await handleMarkdownRequest({
      ...sharedParams,
      request: new Request(`https://example.com${buildMarkdownPagePath({ pathname })}`),
    });
    // The KV write is a `waitUntil` task, so it must settle before the cached read below.
    await Promise.all(pending);
    const downloaded = await handleMarkdownRequest({
      ...sharedParams,
      request: new Request(
        `https://example.com${buildMarkdownPagePath({ pathname, download: true })}`,
      ),
    });

    const siteSlug = SITE_NAME.toLowerCase().replace(/\s+/g, "-");
    expect(plain?.headers.get("content-disposition")).toBeNull();
    expect(downloaded?.headers.get("content-disposition")).toBe(
      `attachment; filename="${siteSlug}-blog-tags-react.md"`,
    );
    // The cache key is pathname-only, so the download response above is a cached hit that still
    // carries the header, and both bodies are the same.
    expect(render).toHaveBeenCalledOnce();
    await expect(downloaded?.text()).resolves.toBe(await plain!.text());
  });

  test("names the download after the site root when the page is the root page", async () => {
    const kv = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
    };
    const render = vi.fn(async () => new Response(
      `<html><head><title>Home - ${SITE_NAME}</title></head><body><main><h1>Home</h1><p>Body</p></main></body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    ));

    const response = await handleMarkdownRequest({
      request: new Request(
        `https://example.com${buildMarkdownPagePath({ pathname: "/", download: true })}`,
      ),
      env: { NEXT_INC_CACHE_KV: kv } as unknown as Env,
      ctx: { waitUntil: () => undefined } as unknown as ExecutionContext,
      render,
    });

    const siteSlug = SITE_NAME.toLowerCase().replace(/\s+/g, "-");
    expect(response?.headers.get("content-disposition")).toBe(
      `attachment; filename="${siteSlug}-index.md"`,
    );
  });

  test("keeps the locale and the download flag on the rewritten CMS URL", async () => {
    const kv = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
    };
    const internalUrls: string[] = [];
    const render = vi.fn(async (request: Request) => {
      internalUrls.push(request.url);
      return new Response("# Entry\n", {
        headers: {
          "cache-tag": "cms-entry-blog-launch",
          "content-type": "text/markdown; charset=utf-8",
        },
      });
    });
    const sharedParams = {
      env: { NEXT_INC_CACHE_KV: kv } as unknown as Env,
      ctx: { waitUntil: () => undefined } as unknown as ExecutionContext,
      render,
    };

    const plainResponse = await handleMarkdownRequest({
      ...sharedParams,
      request: new Request("https://example.com/blog/launch.md"),
    });
    await handleMarkdownRequest({
      ...sharedParams,
      request: new Request("https://example.com/blog/launch.md?download"),
    });

    const plain = new URL(internalUrls[0]!);
    const downloaded = new URL(internalUrls[1]!);
    expect(plain.pathname).toBe("/markdown/blog/launch");
    expect(plain.searchParams.get("locale")).toBe(DEFAULT_LOCALE);
    expect(plain.searchParams.has(MARKDOWN_DOWNLOAD_PARAM)).toBe(false);
    expect(plainResponse?.headers.get("cache-tag")).toBe("cms-entry-blog-launch");
    // The CMS route handler sets the disposition itself, from its own URL, so the flag must survive
    // the rewrite next to the locale.
    expect(downloaded.pathname).toBe("/markdown/blog/launch");
    expect(downloaded.searchParams.get("locale")).toBe(DEFAULT_LOCALE);
    expect(downloaded.searchParams.has(MARKDOWN_DOWNLOAD_PARAM)).toBe(true);
  });

  // A `.md` URL promises Markdown, so a page the converter cannot frame answers 406 with a problem
  // document rather than the HTML body it rendered.
  test("answers 406 without caching when the page cannot be converted", async () => {
    const kv = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
    };
    // No `main` element, which is the one shape the converter refuses.
    const html = `<html><head><title>Terms - ${SITE_NAME}</title></head><body><p>Body</p></body></html>`;
    const render = vi.fn(async () => new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    }));
    const pending: Array<Promise<unknown>> = [];

    const response = await handleMarkdownRequest({
      request: new Request(
        `https://example.com${buildMarkdownPagePath({ pathname: PAGE_PATHNAME })}`,
      ),
      env: { NEXT_INC_CACHE_KV: kv } as unknown as Env,
      ctx: {
        waitUntil: (promise: Promise<unknown>) => {
          pending.push(promise);
        },
      } as unknown as ExecutionContext,
      render,
    });
    await Promise.all(pending);

    expect(response?.status).toBe(MARKDOWN_UNAVAILABLE_STATUS);
    expect(response?.headers.get("content-type")).toBe("application/problem+json");
    // The next deploy may convert the same page, so neither KV nor a shared cache may keep this.
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(kv.put).not.toHaveBeenCalled();

    const body = await response!.json() as { code: string; detail: string; status: number };
    expect(body.code).toBe(MARKDOWN_UNAVAILABLE_CODE);
    expect(body.status).toBe(MARKDOWN_UNAVAILABLE_STATUS);
    // The way out: the same page as HTML.
    expect(body.detail).toContain(buildAbsoluteSourcePageUrl({ pathname: PAGE_PATHNAME }));
  });

  // The body is dropped for HEAD in one place, so the 406 must still arrive as a 406.
  test("keeps the 406 status on a HEAD request that cannot be converted", async () => {
    const kv = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
    };
    const render = vi.fn(async () => new Response(
      `<html><head><title>Terms - ${SITE_NAME}</title></head><body><p>Body</p></body></html>`,
      { headers: { "content-type": "text/html; charset=utf-8" } },
    ));

    const response = await handleMarkdownRequest({
      request: new Request(
        `https://example.com${buildMarkdownPagePath({ pathname: PAGE_PATHNAME })}`,
        { method: "HEAD" },
      ),
      env: { NEXT_INC_CACHE_KV: kv } as unknown as Env,
      ctx: { waitUntil: () => undefined } as unknown as ExecutionContext,
      render,
    });

    expect(response?.status).toBe(MARKDOWN_UNAVAILABLE_STATUS);
    expect(response?.headers.get("content-type")).toBe("application/problem+json");
    expect(response?.body).toBeNull();
  });

  test("drops the body of a HEAD response but keeps its headers", async () => {
    const kv = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
    };
    let renderedMethod: string | null = null;
    const render = vi.fn(async (request: Request) => {
      renderedMethod = request.method;
      return new Response("# Entry\n", {
        headers: {
          "cache-tag": "cms-entry-blog-launch",
          "content-type": "text/markdown; charset=utf-8",
        },
      });
    });

    const response = await handleMarkdownRequest({
      request: new Request("https://example.com/blog/launch.md", { method: "HEAD" }),
      env: { NEXT_INC_CACHE_KV: kv } as unknown as Env,
      ctx: { waitUntil: () => undefined } as unknown as ExecutionContext,
      render,
    });

    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-tag")).toBe("cms-entry-blog-launch");
    expect(response?.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(response?.headers.get("link")).toBe(LLMS_DESCRIBED_BY_LINK);
    expect(response?.body).toBeNull();
    // The inner render always sees a GET, whatever method the caller sent.
    expect(renderedMethod).toBe("GET");
  });
});
