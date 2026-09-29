import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { collectionSlugs } from "@/../cms.config";
import { DEFAULT_LOCALE, ENABLED_LOCALES } from "@/i18n/config";
import { cmsEntryListingPath, cmsEntryPagePath } from "@/lib/cms/cms-entry-page-purge";
import { buildAbsoluteMarkdownPageUrl, localizedPagePathname } from "@/lib/markdown-pages/page-paths";
import { absoluteLocalizedUrl } from "@/utils/i18n-urls";

const {
  getEntryLocalesMock,
  isLocalhostMock,
  isTestModeMock,
  runInBackgroundMock,
  warmSpans,
} = vi.hoisted(() => ({
  getEntryLocalesMock: vi.fn(),
  isLocalhostMock: { value: false },
  isTestModeMock: vi.fn(() => false),
  runInBackgroundMock: vi.fn(),
  warmSpans: [] as Array<{ name: string; attributes: Record<string, unknown> }>,
}));

vi.mock("server-only", () => ({}));

// Reached through the shared entry-path helpers, which sit beside the KV purge sweep.
vi.mock("cloudflare:workers", () => ({
  env: {},
}));

vi.mock("@/utils/trace", () => ({
  withSpan: ({ name, run }: { name: string; run: (span: unknown) => Promise<unknown> }) => {
    const record = { name, attributes: {} as Record<string, unknown> };
    const span = {
      isTraced: true,
      setAttributes: (values: Record<string, unknown>) => {
        Object.assign(record.attributes, values);
        return span;
      },
    };

    warmSpans.push(record);
    return run(span);
  },
}));

vi.mock("@/lib/cms/entry/queries", () => ({
  getEntryLocales: getEntryLocalesMock,
}));

vi.mock("@/utils/is-local", () => ({
  get isLocalhost() {
    return isLocalhostMock.value;
  },
}));

vi.mock("@/utils/is-test-mode", () => ({
  isTestMode: isTestModeMock,
}));

// The real helper needs a Worker `waitUntil`; capturing the promise lets each test await the fetches.
vi.mock("@/utils/run-in-background", () => ({
  runInBackground: runInBackgroundMock,
}));

const { CMS_WARM_USER_AGENT, MAX_WARM_URLS_PER_CALL, warmCmsEntryPages } = await import(
  "./warm-cms-pages"
);

/** The first collection that publishes a public page, so the test follows the template's own config. */
const WARMABLE_COLLECTION = collectionSlugs.find(
  (collectionSlug) => cmsEntryPagePath({ collection: collectionSlug, slug: "probe" }) !== null,
);

const SLUG = "launch-notes";

async function flushWarms(): Promise<void> {
  for (const [promise] of runInBackgroundMock.mock.calls) {
    await promise;
  }
}

function warmedUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(([url]) => url as string);
}

describe.skipIf(!WARMABLE_COLLECTION)("warmCmsEntryPages", () => {
  const collection = WARMABLE_COLLECTION as NonNullable<typeof WARMABLE_COLLECTION>;
  const pagePath = cmsEntryPagePath({ collection, slug: SLUG }) as string;
  const listingPath = cmsEntryListingPath(pagePath);
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    isLocalhostMock.value = false;
    isTestModeMock.mockReturnValue(false);
    getEntryLocalesMock.mockResolvedValue([DEFAULT_LOCALE]);
    fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    warmSpans.length = 0;
  });

  test("warms the entry page, its listing, and both Markdown twins", async () => {
    warmCmsEntryPages({ entries: [{ collection, slug: SLUG }] });
    await flushWarms();

    const urls = warmedUrls(fetchMock);

    expect(urls).toContain(absoluteLocalizedUrl({ pathname: pagePath, locale: DEFAULT_LOCALE }));
    expect(urls).toContain(absoluteLocalizedUrl({ pathname: listingPath, locale: DEFAULT_LOCALE }));
    expect(urls).toContain(
      buildAbsoluteMarkdownPageUrl({
        pathname: localizedPagePathname({ locale: DEFAULT_LOCALE, pathname: pagePath }),
      }),
    );
    expect(urls).toContain(
      buildAbsoluteMarkdownPageUrl({
        pathname: localizedPagePathname({ locale: DEFAULT_LOCALE, pathname: listingPath }),
      }),
    );
  });

  test("sends a GET that names the warmer", async () => {
    warmCmsEntryPages({ entries: [{ collection, slug: SLUG }] });
    await flushWarms();

    expect(fetchMock).toHaveBeenCalled();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>)["user-agent"]).toBe(CMS_WARM_USER_AGENT);
  });

  test("warms every locale the entry exists in", async () => {
    getEntryLocalesMock.mockResolvedValue([...ENABLED_LOCALES]);

    warmCmsEntryPages({ entries: [{ collection, slug: SLUG }] });
    await flushWarms();

    const urls = warmedUrls(fetchMock);

    for (const locale of ENABLED_LOCALES) {
      expect(urls).toContain(absoluteLocalizedUrl({ pathname: pagePath, locale }));
    }
  });

  test("falls back to the default locale when the locale list is unreadable", async () => {
    getEntryLocalesMock.mockRejectedValue(new Error("no request scope"));

    warmCmsEntryPages({ entries: [{ collection, slug: SLUG }] });
    await flushWarms();

    expect(warmedUrls(fetchMock)).toContain(
      absoluteLocalizedUrl({ pathname: pagePath, locale: DEFAULT_LOCALE }),
    );
  });

  // The cap stops the entry loop, so it bounds the locale reads as well as the fetches: an entry
  // the call can spend no URL on must not cost a D1 read either.
  test("never spends more than the per-call URL bound", async () => {
    const entryCount = 20;
    getEntryLocalesMock.mockResolvedValue([...ENABLED_LOCALES]);

    warmCmsEntryPages({
      entries: Array.from({ length: entryCount }, (_unused, index) => ({
        collection,
        slug: `${SLUG}-${index}`,
      })),
    });
    await flushWarms();

    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(MAX_WARM_URLS_PER_CALL);
    expect(getEntryLocalesMock.mock.calls.length).toBeLessThan(entryCount);
  });

  test("a failing warm neither throws nor stops the other URLs", async () => {
    fetchMock.mockRejectedValueOnce(new Error("origin down"));

    expect(() => warmCmsEntryPages({ entries: [{ collection, slug: SLUG }] })).not.toThrow();
    await expect(flushWarms()).resolves.toBeUndefined();

    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  test("records the URL count and the ok and failed fetches on the warm span", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("origin down"))
      .mockResolvedValueOnce(new Response("", { status: 500 }));

    warmCmsEntryPages({ entries: [{ collection, slug: SLUG }] });
    await flushWarms();

    const urlCount = fetchMock.mock.calls.length;
    expect(warmSpans).toEqual([{
      name: "app.cms.warm",
      attributes: {
        "app.cms.url_count": urlCount,
        "app.cms.capped": false,
        "app.cms.warm_ok_count": urlCount - 2,
        "app.cms.warm_failed_count": 2,
      },
    }]);
  });

  test("marks the warm span capped when the URL bound drops URLs", async () => {
    getEntryLocalesMock.mockResolvedValue([...ENABLED_LOCALES]);

    warmCmsEntryPages({
      entries: Array.from({ length: 20 }, (_unused, index) => ({ collection, slug: `${SLUG}-${index}` })),
    });
    await flushWarms();

    expect(warmSpans[0]?.attributes).toMatchObject({
      "app.cms.url_count": MAX_WARM_URLS_PER_CALL,
      "app.cms.capped": true,
    });
  });

  test("warms nothing on localhost", async () => {
    isLocalhostMock.value = true;

    warmCmsEntryPages({ entries: [{ collection, slug: SLUG }] });
    await flushWarms();

    expect(runInBackgroundMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("warms nothing in test mode", async () => {
    isTestModeMock.mockReturnValue(true);

    warmCmsEntryPages({ entries: [{ collection, slug: SLUG }] });
    await flushWarms();

    expect(runInBackgroundMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
