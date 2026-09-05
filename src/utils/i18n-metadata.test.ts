import { describe, expect, test, vi } from "vitest";

import { API_DOCS_PATH, I18N_ENABLED, SITE_URL } from "@/constants";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/i18n/config";

vi.mock("server-only", () => ({}));

// `@/i18n/navigation` re-exports next-intl's `createNavigation` helpers, which pull in `next/navigation`
// client hooks that don't resolve in a plain Node/vitest module graph (no Vinext/Vite shim present).
// `getPathname` itself is pure path-building logic, so fake it directly against the `routing` config instead of exercising next-intl/next's internals here.
vi.mock("@/i18n/navigation", async () => {
  const { DEFAULT_LOCALE } = await import("@/i18n/config");

  return {
    getPathname: ({ href, locale }: { href: string; locale: string }) =>
      locale === DEFAULT_LOCALE ? href : `/${locale}${href}`,
  };
});

const NON_DEFAULT_LOCALE = LOCALES.find((locale) => locale !== DEFAULT_LOCALE) as Locale;

const { buildAlternates, buildPaginatedAlternates, noindexNonDefaultLocale } = await import("./i18n-metadata");

describe("buildAlternates", () => {
  test("advertises a Markdown alternate for a supported public page", () => {
    const alternates = buildAlternates({
      pathname: API_DOCS_PATH,
      locale: DEFAULT_LOCALE,
      availableLocales: LOCALES,
    });

    expect(alternates!.types).toEqual({
      "text/markdown": `${SITE_URL}${API_DOCS_PATH}.md`,
    });
  });

  test("uses the index Markdown path for the site root", () => {
    const alternates = buildAlternates({
      pathname: "/",
      locale: DEFAULT_LOCALE,
      availableLocales: LOCALES,
    });

    expect(alternates!.types).toEqual({
      "text/markdown": `${SITE_URL}/index.md`,
    });
  });

  test.skipIf(!I18N_ENABLED)("uses the active locale in the Markdown alternate", () => {
    const alternates = buildAlternates({
      pathname: API_DOCS_PATH,
      locale: NON_DEFAULT_LOCALE,
      availableLocales: LOCALES,
    });

    expect(alternates!.types).toEqual({
      "text/markdown": `${SITE_URL}/${NON_DEFAULT_LOCALE}${API_DOCS_PATH}.md`,
    });
  });

  test("omits the Markdown alternate when the route does not support Markdown", () => {
    const alternates = buildAlternates({
      pathname: "/sign-in",
      locale: DEFAULT_LOCALE,
      availableLocales: LOCALES,
    });

    expect(alternates!.types).toBeUndefined();
  });

  test("canonical is the active locale's own URL", () => {
    const alternates = buildAlternates({
      pathname: "/privacy",
      locale: NON_DEFAULT_LOCALE,
      availableLocales: LOCALES,
    });

    expect(alternates!.canonical).toBe(`${SITE_URL}/${NON_DEFAULT_LOCALE}/privacy`);
  });

  test("canonical for the default locale has no locale prefix", () => {
    const alternates = buildAlternates({
      pathname: "/privacy",
      locale: DEFAULT_LOCALE,
      availableLocales: LOCALES,
    });

    expect(alternates!.canonical).toBe(`${SITE_URL}/privacy`);
  });

  // hreflang alternates only exist when i18n is enabled; disabled builds emit just
  // the canonical, so guard these on the flag and cover the disabled case below.
  test.skipIf(!I18N_ENABLED)("languages has one hreflang entry per available locale plus x-default", () => {
    const alternates = buildAlternates({
      pathname: "/privacy",
      locale: NON_DEFAULT_LOCALE,
      availableLocales: LOCALES,
    });

    const languages = alternates!.languages as Record<string, string>;

    for (const locale of LOCALES) {
      expect(languages[locale]).toBeDefined();
    }
    expect(languages["x-default"]).toBeDefined();
  });

  test.skipIf(!I18N_ENABLED)("hreflang URLs derive from SITE_URL and locale-specific pathnames", () => {
    const alternates = buildAlternates({
      pathname: "/privacy",
      locale: NON_DEFAULT_LOCALE,
      availableLocales: LOCALES,
    });

    const languages = alternates!.languages as Record<string, string>;

    expect(languages[DEFAULT_LOCALE]).toBe(`${SITE_URL}/privacy`);
    expect(languages[NON_DEFAULT_LOCALE]).toBe(`${SITE_URL}/${NON_DEFAULT_LOCALE}/privacy`);
  });

  test.skipIf(!I18N_ENABLED)("x-default points at the default-locale URL", () => {
    const alternates = buildAlternates({
      pathname: "/privacy",
      locale: NON_DEFAULT_LOCALE,
      availableLocales: LOCALES,
    });

    const languages = alternates!.languages as Record<string, string>;

    expect(languages["x-default"]).toBe(`${SITE_URL}/privacy`);
  });

  test.skipIf(I18N_ENABLED)("emits only a canonical (no hreflang) when i18n is disabled", () => {
    const alternates = buildAlternates({
      pathname: "/privacy",
      locale: DEFAULT_LOCALE,
      availableLocales: LOCALES,
    });

    expect(alternates!.canonical).toBe(`${SITE_URL}/privacy`);
    expect(alternates!.languages).toBeUndefined();
  });

  test("canonical and hreflang URLs preserve SITE_URL's path prefix", async () => {
    vi.resetModules();
    vi.doMock("@/constants", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/constants")>()),
      I18N_ENABLED: true,
      SITE_URL: "https://example.com/app",
    }));
    vi.doMock("@/i18n/navigation", async () => {
      const { DEFAULT_LOCALE } = await import("@/i18n/config");

      return {
        getPathname: ({ href, locale }: { href: string; locale: string }) =>
          locale === DEFAULT_LOCALE ? href : `/${locale}${href}`,
      };
    });

    const { buildAlternates } = await import("./i18n-metadata");
    const alternates = buildAlternates({
      pathname: "/privacy",
      locale: NON_DEFAULT_LOCALE,
      availableLocales: LOCALES,
    });
    const languages = alternates!.languages as Record<string, string>;

    expect(alternates!.canonical).toBe(`https://example.com/app/${NON_DEFAULT_LOCALE}/privacy`);
    expect(languages[DEFAULT_LOCALE]).toBe("https://example.com/app/privacy");
    expect(languages[NON_DEFAULT_LOCALE]).toBe(
      `https://example.com/app/${NON_DEFAULT_LOCALE}/privacy`,
    );
    expect(alternates!.types).toEqual({
      "text/markdown": `https://example.com/app/${NON_DEFAULT_LOCALE}/privacy.md`,
    });
  });
});

describe("noindexNonDefaultLocale", () => {
  test("returns a noindex robots directive for a non-default locale", () => {
    expect(noindexNonDefaultLocale(NON_DEFAULT_LOCALE)).toEqual({
      robots: { index: false, follow: true },
    });
  });

  test("returns an empty object for the default locale", () => {
    expect(noindexNonDefaultLocale(DEFAULT_LOCALE)).toEqual({});
  });
});

// Blog/docs `generateMetadata` compose these two helpers for a fallback render (active locale has no
// translation, default-locale content is served under the active locale's URL instead of redirecting — see
// resolve-localized-entry.ts and resolve-docs-page.ts). This documents/locks the exact contract those pages depend on: noindex the untranslated page and canonicalize it at the real default-locale URL, while still advertising only genuine translations via hreflang. Getting this wrong (e.g. self-canonicalizing) would resurrect the mixed-language/duplicate-content risk the redirect was originally (incorrectly) trying to solve.
describe("fallback-render metadata composition (blog/docs untranslated pages)", () => {
  test("noindexes the untranslated locale render", () => {
    const fallbackMetadata = noindexNonDefaultLocale(NON_DEFAULT_LOCALE);
    expect(fallbackMetadata).toEqual({ robots: { index: false, follow: true } });
  });

  test("canonicalizes at the default-locale URL, not the active (untranslated) locale's URL", () => {
    const alternates = buildAlternates({
      pathname: "/blog/only-in-default-locale",
      locale: DEFAULT_LOCALE,
      availableLocales: [DEFAULT_LOCALE],
    });

    expect(alternates!.canonical).toBe(`${SITE_URL}/blog/only-in-default-locale`);
    expect(alternates!.canonical).not.toContain(`/${NON_DEFAULT_LOCALE}/`);
  });

  test.skipIf(!I18N_ENABLED)("hreflang only advertises locales that actually have a translation row", () => {
    // Only the default locale has a real row; hreflang must not claim the active
    // locale is a translation just because the page renders there as a fallback.
    const alternates = buildAlternates({
      pathname: "/blog/only-in-default-locale",
      locale: DEFAULT_LOCALE,
      availableLocales: [DEFAULT_LOCALE],
    });

    const languages = alternates!.languages as Record<string, string>;
    expect(languages[DEFAULT_LOCALE]).toBeDefined();
    expect(languages[NON_DEFAULT_LOCALE]).toBeUndefined();
  });
});

describe("buildPaginatedAlternates", () => {
  const options = { pathname: "/blog", locale: DEFAULT_LOCALE, availableLocales: LOCALES };

  test("keeps the full alternates on page one", () => {
    expect(buildPaginatedAlternates({ ...options, page: 1 })).toEqual(buildAlternates(options));
  });

  test("keeps the canonical of a numbered page", () => {
    const alternates = buildPaginatedAlternates({ ...options, pathname: "/blog/2", page: 2 });

    expect(alternates!.canonical).toBe(`${SITE_URL}/blog/2`);
  });

  test.skipIf(!I18N_ENABLED)("advertises a numbered page in every locale that has it", () => {
    const alternates = buildPaginatedAlternates({ ...options, pathname: "/blog/2", page: 2 });
    const languages = alternates!.languages as Record<string, string>;

    for (const locale of LOCALES) {
      expect(languages[locale]).toBeDefined();
    }
    expect(languages["x-default"]).toBe(`${SITE_URL}/blog/2`);
  });

  test.skipIf(!I18N_ENABLED)("omits a locale that runs out of pages, and x-default with the default locale", () => {
    const alternates = buildPaginatedAlternates({
      ...options,
      pathname: "/blog/2",
      locale: NON_DEFAULT_LOCALE,
      availableLocales: [NON_DEFAULT_LOCALE],
      page: 2,
    });
    const languages = alternates!.languages as Record<string, string>;

    expect(languages).toEqual({
      [NON_DEFAULT_LOCALE]: `${SITE_URL}/${NON_DEFAULT_LOCALE}/blog/2`,
    });
  });
});
