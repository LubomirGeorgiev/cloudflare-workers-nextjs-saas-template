import { describe, expect, test } from "vitest";

import { matchAcceptLanguage, resolveLocaleAsProxyWould } from "./accept-language";
import { DEFAULT_LOCALE, ENABLED_LOCALES } from "./config";

// A served locale and one that is not, derived from the enabled list for template safety. When
// i18n is disabled the served set is just the default, so `supportedLocale` collapses to it.
const supportedLocale = ENABLED_LOCALES[ENABLED_LOCALES.length - 1];
const unsupportedLocale = "zz";

describe("matchAcceptLanguage", () => {
  test("negotiates the highest-quality supported language", () => {
    expect(matchAcceptLanguage(`${unsupportedLocale};q=1.0, ${supportedLocale};q=0.7`)).toBe(
      supportedLocale,
    );
  });

  test("matches a regional tag on its base language", () => {
    expect(matchAcceptLanguage(`${supportedLocale}-XX`)).toBe(supportedLocale);
  });

  test.each([
    ["no header", null],
    ["an empty header", ""],
    ["only unsupported languages", `${unsupportedLocale}-XX,${unsupportedLocale};q=0.9`],
  ])("returns nothing for %s", (_label, header) => {
    expect(matchAcceptLanguage(header)).toBeUndefined();
  });
});

// These pin our mirror of the middleware's answers (`getAcceptLanguageLocale` in next-intl), which
// is what the edge HTML cache must agree with when it decides whether a hit writes the locale
// cookie. The mirror is pinned to next-intl itself in `tests/integration/worker-edge.test.ts`,
// where a hit's locale cookie must equal the one a miss gets from the real middleware.
describe("resolveLocaleAsProxyWould", () => {
  test.each([
    ["no header", null],
    ["an empty header", ""],
    ["a wildcard", "*"],
    ["a wildcard with a quality value", "*;q=0.5"],
    ["a list of wildcards", "*, *;q=0.1"],
  ])("negotiates nothing for %s", (_label, header) => {
    expect(resolveLocaleAsProxyWould(header)).toBeUndefined();
  });

  test("falls back to the default locale when no tag matches", () => {
    expect(resolveLocaleAsProxyWould(unsupportedLocale)).toBe(DEFAULT_LOCALE);
  });

  test("negotiates past a wildcard that outranks every real tag", () => {
    expect(resolveLocaleAsProxyWould(`*;q=1.0, ${supportedLocale};q=0.5`)).toBe(supportedLocale);
  });

  test("negotiates a supported language", () => {
    expect(resolveLocaleAsProxyWould(`${supportedLocale}-XX,${unsupportedLocale};q=0.9`)).toBe(
      supportedLocale,
    );
  });
});
