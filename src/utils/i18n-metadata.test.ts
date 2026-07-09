import { describe, expect, test, vi } from "vitest";

import { I18N_ENABLED, SITE_URL } from "@/constants";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";

vi.mock("server-only", () => ({}));

// `@/i18n/navigation` re-exports next-intl's `createNavigation` helpers, which pull in `next/navigation`
// client hooks that don't resolve in a plain Node/vitest module graph (no Vinext/Vite shim present).
// `getPathname` itself is pure path-building logic, so fake it directly against the `routing` config instead of exercising next-intl/next's internals here.
vi.mock("@/i18n/navigation", () => ({
  getPathname: ({ href, locale }: { href: string; locale: string }) =>
    locale === "en" ? href : `/${locale}${href}`,
}));

const { buildAlternates, noindexNonDefaultLocale } = await import("./i18n-metadata");

describe("buildAlternates", () => {
  test("canonical is the active locale's own URL", () => {
    const alternates = buildAlternates({
      pathname: "/privacy",
      locale: "es",
      availableLocales: LOCALES,
    });

    expect(alternates!.canonical).toBe(`${SITE_URL}/es/privacy`);
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
      locale: "es",
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
      locale: "es",
      availableLocales: LOCALES,
    });

    const languages = alternates!.languages as Record<string, string>;

    expect(languages.en).toBe(`${SITE_URL}/privacy`);
    expect(languages.es).toBe(`${SITE_URL}/es/privacy`);
  });

  test.skipIf(!I18N_ENABLED)("x-default points at the default-locale URL", () => {
    const alternates = buildAlternates({
      pathname: "/privacy",
      locale: "es",
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
    vi.doMock("@/i18n/navigation", () => ({
      getPathname: ({ href, locale }: { href: string; locale: string }) =>
        locale === "en" ? href : `/${locale}${href}`,
    }));

    const { buildAlternates } = await import("./i18n-metadata");
    const alternates = buildAlternates({
      pathname: "/privacy",
      locale: "es",
      availableLocales: LOCALES,
    });
    const languages = alternates!.languages as Record<string, string>;

    expect(alternates!.canonical).toBe("https://example.com/app/es/privacy");
    expect(languages.en).toBe("https://example.com/app/privacy");
    expect(languages.es).toBe("https://example.com/app/es/privacy");
  });
});

describe("noindexNonDefaultLocale", () => {
  test("returns a noindex robots directive for a non-default locale", () => {
    expect(noindexNonDefaultLocale("es")).toEqual({
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
    const fallbackMetadata = noindexNonDefaultLocale("es");
    expect(fallbackMetadata).toEqual({ robots: { index: false, follow: true } });
  });

  test("canonicalizes at the default-locale URL, not the active (untranslated) locale's URL", () => {
    const alternates = buildAlternates({
      pathname: "/blog/only-in-english",
      locale: DEFAULT_LOCALE,
      availableLocales: ["en"],
    });

    expect(alternates!.canonical).toBe(`${SITE_URL}/blog/only-in-english`);
    expect(alternates!.canonical).not.toContain("/es/");
  });

  test.skipIf(!I18N_ENABLED)("hreflang only advertises locales that actually have a translation row", () => {
    // Only 'en' has a real row; hreflang must not claim 'es' is a translation
    // just because the page happens to render (as a fallback) under /es/*.
    const alternates = buildAlternates({
      pathname: "/blog/only-in-english",
      locale: DEFAULT_LOCALE,
      availableLocales: ["en"],
    });

    const languages = alternates!.languages as Record<string, string>;
    expect(languages.en).toBeDefined();
    expect(languages.es).toBeUndefined();
  });
});
