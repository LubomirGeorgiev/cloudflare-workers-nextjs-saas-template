import { describe, expect, test } from "vitest";

import { DEFAULT_LOCALE, ENABLED_LOCALES, LOCALE_DETECTION } from "./config";
import { negotiateAcceptLanguage, resolveRequestLocale } from "./resolve-locale";

// A served locale and one that is not, derived from the enabled list for template safety. When i18n
// is disabled the served set is just the default, so `supportedLocale` collapses to it.
const supportedLocale = ENABLED_LOCALES[ENABLED_LOCALES.length - 1];
const unsupportedLocale = "zz";
const alternateLocale = ENABLED_LOCALES.find((locale) => locale !== DEFAULT_LOCALE);

function resolve({
  pathname = "/",
  cookieLocale = null,
  acceptLanguage = null,
}: {
  pathname?: string;
  cookieLocale?: string | null;
  acceptLanguage?: string | null;
} = {}) {
  return resolveRequestLocale({ pathname, cookieLocale, acceptLanguage });
}

describe("negotiateAcceptLanguage", () => {
  test.each([
    ["no header", null],
    ["an empty header", ""],
    ["a wildcard", "*"],
    ["a wildcard with a quality value", "*;q=0.5"],
    ["a list of wildcards", "*, *;q=0.1"],
  ])("negotiates the default locale for %s", (_label, header) => {
    expect(negotiateAcceptLanguage(header)).toBe(DEFAULT_LOCALE);
  });

  test("falls back to the default locale when no tag matches", () => {
    expect(negotiateAcceptLanguage(unsupportedLocale)).toBe(DEFAULT_LOCALE);
  });

  test("negotiates the highest-quality supported language", () => {
    expect(negotiateAcceptLanguage(`${unsupportedLocale};q=1.0, ${supportedLocale};q=0.7`)).toBe(
      supportedLocale,
    );
  });

  test("matches a regional tag on its base language", () => {
    expect(negotiateAcceptLanguage(`${supportedLocale}-XX`)).toBe(supportedLocale);
  });

  test("negotiates past a wildcard that outranks every real tag", () => {
    expect(negotiateAcceptLanguage(`*;q=1.0, ${supportedLocale};q=0.5`)).toBe(supportedLocale);
  });
});

describe("resolveRequestLocale", () => {
  test.each(ENABLED_LOCALES)("reads the %s URL prefix, whatever else the request says", (locale) => {
    expect(
      resolve({
        pathname: `/${locale}/blog`,
        cookieLocale: unsupportedLocale,
        acceptLanguage: unsupportedLocale,
      }),
    ).toEqual({
      locale,
      pathname: "/blog",
    });
  });

  test("hands back the whole path when it carries no prefix", () => {
    expect(resolve({ pathname: "/blog" })).toMatchObject({ pathname: "/blog" });
  });

  test("falls back to the default locale when nothing names one", () => {
    expect(resolve()).toMatchObject({ locale: DEFAULT_LOCALE });
  });

  test("ignores a cookie the served set no longer holds", () => {
    expect(resolve({ cookieLocale: unsupportedLocale })).toMatchObject({
      locale: DEFAULT_LOCALE,
    });
  });

  test.runIf(LOCALE_DETECTION && alternateLocale !== undefined)(
    "prefers the cookie over Accept-Language",
    () => {
      expect(
        resolve({ cookieLocale: alternateLocale, acceptLanguage: DEFAULT_LOCALE }),
      ).toMatchObject({ locale: alternateLocale });
    },
  );

  test.runIf(LOCALE_DETECTION && alternateLocale !== undefined)(
    "negotiates Accept-Language when no cookie names a locale",
    () => {
      expect(resolve({ acceptLanguage: `${alternateLocale}-XX;q=0.9` })).toMatchObject({
        locale: alternateLocale,
      });
    },
  );

  test.runIf(!LOCALE_DETECTION)("negotiates nothing while one locale is served", () => {
    expect(resolve({ cookieLocale: unsupportedLocale, acceptLanguage: unsupportedLocale })).toMatchObject({
      locale: DEFAULT_LOCALE,
    });
  });

  // Pins the split between "what locale is this request" and "what locale is this person". A stored
  // `preferredLocale` answers the second question only; `getUserLocale` in `./locale.ts` reads it.
  // Adding it here would cost a D1 query at the edge on every public page.
  test("takes no user, so a stored preference can never decide a request", () => {
    expect(resolveRequestLocale).toHaveLength(1);
    expect(resolve({ acceptLanguage: DEFAULT_LOCALE })).toMatchObject({ locale: DEFAULT_LOCALE });
  });
});
