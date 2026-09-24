import { describe, expect, test } from "vitest";

import {
  DEFAULT_LOCALE,
  ENABLED_LOCALES,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  LOCALE_DETECTION,
  LOCALE_HEADER_NAME,
  LOCALES,
} from "./config";
import { buildLocaleCookieValue } from "./locale-cookie";
import { localizedPathname } from "./localized-pathname";

// The as-needed prefix contract is SEO-critical: the default locale is served at the bare path and
// every other locale is prefixed. `src/i18n/middleware.test.ts` pins the routing that follows from
// it; this file pins the values the middleware, the switcher, and the edge cache all read.
describe("locale routing configuration", () => {
  test.each(ENABLED_LOCALES)("serves %s at its as-needed URL", (locale) => {
    expect(localizedPathname({ pathname: "/blog", locale })).toBe(
      locale === DEFAULT_LOCALE ? "/blog" : `/${locale}/blog`,
    );
    expect(localizedPathname({ pathname: "/blog", locale, forcePrefix: true })).toBe(
      `/${locale}/blog`,
    );
  });

  test("serves a subset of the catalog that always contains the default locale", () => {
    expect(ENABLED_LOCALES).toContain(DEFAULT_LOCALE);
    expect(LOCALES).toEqual(expect.arrayContaining([...ENABLED_LOCALES]));
  });

  // With one served locale there is nothing to negotiate onto, so detection follows the served set.
  test("negotiates only while more than the default locale is served", () => {
    expect(LOCALE_DETECTION).toBe(ENABLED_LOCALES.length > 1);
  });

  // A forwarded request header name is compared in lowercase.
  test("forwards the resolved locale under a lowercase header name", () => {
    expect(LOCALE_HEADER_NAME).toBe(LOCALE_HEADER_NAME.toLowerCase());
  });

  // Every writer of this cookie goes through `buildLocaleCookieValue`, so the attributes cannot drift.
  test("writes the locale cookie under the shared name and lifetime", () => {
    expect(buildLocaleCookieValue(DEFAULT_LOCALE)).toBe(
      `${LOCALE_COOKIE_NAME}=${DEFAULT_LOCALE}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`,
    );
  });
});
