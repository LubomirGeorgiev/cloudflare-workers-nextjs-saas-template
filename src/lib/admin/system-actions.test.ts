import { afterEach, beforeEach, expect, test, vi } from "vitest";

// The edge HTML cache key carries the build id, which only the Vite build injects.
vi.stubGlobal("__MARKDOWN_BUILD_ID__", "test-build-id");

// The Cache API purge, exercised through the real key builder: the point of the test is that the
// admin action hands `purgeEdgeHtmlPages` locale-free pathnames, so no key is prefixed twice.

const { collectPublicPagesMock, getCachePurgeConfigMock, purgeZoneCacheEverythingMock, workerEnv } =
  vi.hoisted(() => ({
    collectPublicPagesMock: vi.fn(),
    getCachePurgeConfigMock: vi.fn(),
    purgeZoneCacheEverythingMock: vi.fn(),
    workerEnv: {} as Record<string, unknown>,
  }));

vi.mock("server-only", () => ({}));

vi.mock("cloudflare:workers", () => ({
  cache: { purge: vi.fn() },
  env: workerEnv,
}));

vi.mock("@/db", () => ({
  getDB: vi.fn(),
}));

vi.mock("@/lib/sitemap/public-pages", () => ({
  collectPublicPages: collectPublicPagesMock,
}));

vi.mock("@/lib/cloudflare-api", () => ({
  getCachePurgeConfig: getCachePurgeConfigMock,
  purgeZoneCacheEverything: purgeZoneCacheEverythingMock,
}));

const { SITE_DOMAIN } = await import("@/constants");
const { BLOG_LISTING_ROUTES, STATIC_PUBLIC_ROUTES } = await import("@/constants/public-routes");
const { DOCS_EDGE_HTML_PATHNAMES } = await import("@/lib/cms/cms-navigation-page-purge");
const { ENABLED_LOCALES } = await import("@/i18n/config");
const { localizedPathname } = await import("@/utils/i18n-urls");
const { getBuildId } = await import("@/utils/build-id");
const { getSystemActionAvailability, purgeCloudflareCdnCache, purgeEdgeHtmlCache } = await import(
  "@/lib/admin/system-actions"
);

const requestedKeys: string[] = [];
const storedKeys = new Set<string>();

function edgeHtmlKeysOf(pathname: string): string[] {
  return ENABLED_LOCALES.map(
    (locale) =>
      `https://${SITE_DOMAIN}/__edge-html/${getBuildId()}${localizedPathname({ pathname, locale })}`,
  );
}

// The pages the action purges whatever the collector returns, so a rejected pathname adds no key.
const ALWAYS_PURGED_PATHNAMES: readonly string[] = [
  ...STATIC_PUBLIC_ROUTES.map(({ pathname }) => pathname),
  ...BLOG_LISTING_ROUTES.map(({ pathname }) => pathname),
  ...DOCS_EDGE_HTML_PATHNAMES,
];

beforeEach(() => {
  requestedKeys.length = 0;
  storedKeys.clear();
  vi.stubGlobal("caches", {
    default: {
      delete: async (key: string) => {
        requestedKeys.push(key);
        return storedKeys.delete(key);
      },
      match: async () => undefined,
      put: async () => undefined,
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test("it purges every public page in every locale and counts the deletes", async () => {
  const entryKeys = edgeHtmlKeysOf("/blog/launch-day");

  collectPublicPagesMock.mockResolvedValue([
    { pathname: "/" },
    { pathname: "/blog/launch-day" },
  ]);
  entryKeys.forEach((key) => storedKeys.add(key));

  const result = await purgeEdgeHtmlCache();

  expect(result.deletedKeyCount).toBe(entryKeys.length);
  expect(result.message).toContain(String(entryKeys.length));
  expect(requestedKeys).toEqual(expect.arrayContaining(entryKeys));
  expect(requestedKeys).toEqual(expect.arrayContaining(edgeHtmlKeysOf("/")));
});

// A fork's `previewUrl` decides the pathname, so nothing stops it returning an absolute, a
// protocol-relative, or a relative URL. The key builder would take that string verbatim and delete
// a key no request could ever store.
test("it drops a page whose pathname is not a rooted path", async () => {
  collectPublicPagesMock.mockResolvedValue([
    { pathname: "https://cdn.example.com/blog/launch-day" },
    { pathname: "//cdn.example.com/x" },
    { pathname: "blog/launch-day" },
  ]);

  await purgeEdgeHtmlCache();

  const expectedKeys = ALWAYS_PURGED_PATHNAMES.flatMap((pathname) => edgeHtmlKeysOf(pathname));

  expect(new Set(requestedKeys)).toEqual(new Set(expectedKeys));
  expect(requestedKeys.some((key) => key.includes("cdn.example.com"))).toBe(false);
  expect(requestedKeys.some((key) => key.endsWith("blog/launch-day"))).toBe(false);
});

// The collector reads the data cache, which needs a request scope the REST and MCP callers lack.
test("it still purges the static routes when the page collector throws", async () => {
  collectPublicPagesMock.mockRejectedValue(new Error("no request scope"));

  const result = await purgeEdgeHtmlCache();

  expect(result.deletedKeyCount).toBe(0);
  expect(requestedKeys).toEqual(expect.arrayContaining(edgeHtmlKeysOf("/")));
  expect(requestedKeys).toEqual(expect.arrayContaining(edgeHtmlKeysOf("/blog")));
  // No key is localized twice: each one is a key the gate could also have built from a request.
  expect(new Set(requestedKeys).size).toBe(requestedKeys.length);
});

// The zone purge is the only action the Worker cannot always perform, so the panel needs the fact
// before it renders. A refusal must name the credential rather than read as an internal failure.
test("the zone purge is unavailable, and refused, without the Cloudflare config", async () => {
  getCachePurgeConfigMock.mockResolvedValue(null);

  expect(await getSystemActionAvailability()).toEqual({ purgeCloudflareCdnCache: false });
  await expect(purgeCloudflareCdnCache()).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
    message: expect.stringContaining("CLOUDFLARE_API_TOKEN"),
  });
  expect(purgeZoneCacheEverythingMock).not.toHaveBeenCalled();
});

test("the zone purge reports the purge Cloudflare accepted", async () => {
  const config = { apiToken: "token-1", zoneId: "zone-1" };
  getCachePurgeConfigMock.mockResolvedValue(config);
  purgeZoneCacheEverythingMock.mockResolvedValue({ purgeId: "zone-1" });

  expect(await getSystemActionAvailability()).toEqual({ purgeCloudflareCdnCache: true });

  const result = await purgeCloudflareCdnCache();

  expect(purgeZoneCacheEverythingMock).toHaveBeenCalledWith(config);
  expect(result.message).toContain("zone-1");
});

test("a refusal from Cloudflare surfaces the reason it gave", async () => {
  getCachePurgeConfigMock.mockResolvedValue({ apiToken: "token-1", zoneId: "zone-1" });
  purgeZoneCacheEverythingMock.mockRejectedValue(new Error("10000: Authentication error"));

  await expect(purgeCloudflareCdnCache()).rejects.toMatchObject({
    code: "INTERNAL_SERVER_ERROR",
    message: expect.stringContaining("10000: Authentication error"),
  });
});
