import { describe, expect, test, vi } from "vitest";

import { I18N_ENABLED, SITE_URL } from "@/constants";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";

vi.mock("server-only", () => ({}));

// `@/i18n/navigation` re-exports next-intl's `createNavigation` helpers, which
// pull in `next/navigation` client hooks that don't resolve in a plain Node/vitest
// module graph (no Vinext/Vite shim present). `getPathname` itself is pure
// path-building logic, so fake it directly against the routing shape instead of
// exercising next-intl/next's internals here (same resolution quirk documented in
// `src/utils/i18n-metadata.test.ts`).
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href, locale }: { href: string; locale: string }) =>
    locale === "en" ? href : `/${locale}${href}`,
}));

const { localizedSitemapAlternates, entryAlternates } = await import("./sitemap-alternates");

// Both helpers advertise per-locale sitemap alternates only when i18n is enabled;
// with the flag off they collapse to an empty map (single canonical URL). Guard the
// enabled-behavior suites on the flag and cover the disabled collapse separately.
describe.skipIf(!I18N_ENABLED)("localizedSitemapAlternates", () => {
  test("returns one URL per LOCALES member plus x-default", () => {
    const languages = localizedSitemapAlternates("/privacy");

    expect(Object.keys(languages).sort()).toEqual([...LOCALES, "x-default"].sort());
  });

  test("x-default points at the default-locale URL", () => {
    const languages = localizedSitemapAlternates("/privacy");

    expect(languages["x-default"]).toBe(languages[DEFAULT_LOCALE]);
  });

  test("blog listing paths advertise every locale plus x-default", () => {
    for (const pathname of ["/blog", "/blog/authors", "/blog/tags"]) {
      const languages = localizedSitemapAlternates(pathname);

      expect(Object.keys(languages).sort()).toEqual([...LOCALES, "x-default"].sort());
    }
  });

  test("every URL is absolute, rooted at SITE_URL's origin", () => {
    const languages = localizedSitemapAlternates("/privacy");
    const origin = new URL(SITE_URL).origin;

    for (const locale of LOCALES) {
      expect(languages[locale].startsWith(origin)).toBe(true);
    }
  });

  test("URLs use locale-specific pathnames from getPathname", () => {
    const languages = localizedSitemapAlternates("/privacy");

    expect(languages.en).toBe(`${SITE_URL}/privacy`);
    expect(languages.es).toBe(`${SITE_URL}/es/privacy`);
  });

  test("root path resolves per-locale using the mocked getPathname output", () => {
    const languages = localizedSitemapAlternates("/");

    expect(languages.en).toBe(new URL("/", SITE_URL).toString());
    expect(languages.es).toBe(new URL("/es/", SITE_URL).toString());
  });
});

describe("entryAlternates", () => {
  test.skipIf(!I18N_ENABLED)("given locales ['en', 'es'] returns both URLs plus x-default", () => {
    const languages = entryAlternates("/blog/hello-world", ["en", "es"]);

    expect(languages).toEqual({
      en: `${SITE_URL}/blog/hello-world`,
      es: `${SITE_URL}/es/blog/hello-world`,
      "x-default": `${SITE_URL}/blog/hello-world`,
    });
  });

  test.skipIf(!I18N_ENABLED)("given locales ['en'] returns the bare URL plus x-default", () => {
    const languages = entryAlternates("/blog/hello-world", ["en"]);

    expect(languages).toEqual({
      en: `${SITE_URL}/blog/hello-world`,
      "x-default": `${SITE_URL}/blog/hello-world`,
    });
  });

  test.skipIf(!I18N_ENABLED)("ignores locale strings that aren't in LOCALES", () => {
    const languages = entryAlternates("/blog/hello-world", ["en", "fr"]);

    expect(languages).toEqual({
      en: `${SITE_URL}/blog/hello-world`,
      "x-default": `${SITE_URL}/blog/hello-world`,
    });
  });

  test("returns an empty object when given no locales (no lone x-default)", () => {
    const languages = entryAlternates("/blog/hello-world", []);

    expect(languages).toEqual({});
  });
});

describe("base-path SITE_URL handling", () => {
  test("localized and entry alternates preserve SITE_URL's path prefix", async () => {
    vi.resetModules();
    vi.doMock("@/constants", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/constants")>()),
      I18N_ENABLED: true,
      SITE_URL: "https://example.com/app",
    }));
    vi.doMock("@/i18n/navigation", () => ({
      getPathname: ({ href, locale }: { href: string; locale: string }) =>
        locale === "en" ? href : `/${locale}${href}`,
    }));

    const { localizedSitemapAlternates, entryAlternates } = await import("./sitemap-alternates");

    expect(localizedSitemapAlternates("/privacy").en).toBe("https://example.com/app/privacy");
    expect(entryAlternates("/blog/hello-world", ["es"]).es).toBe(
      "https://example.com/app/es/blog/hello-world",
    );
  });
});

describe.skipIf(I18N_ENABLED)("locale alternates when i18n is disabled", () => {
  test("both helpers collapse to an empty alternates map", () => {
    expect(localizedSitemapAlternates("/privacy")).toEqual({});
    // Empty even when explicitly handed multiple locales — the flag wins.
    expect(entryAlternates("/blog/hello-world", ["en", "es"])).toEqual({});
  });
});
