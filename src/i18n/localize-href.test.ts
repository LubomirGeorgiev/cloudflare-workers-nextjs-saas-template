import { describe, expect, test } from "vitest";

import { DEFAULT_LOCALE, ENABLED_LOCALES } from "./config";
import { localizeHref, relocalizeHref } from "./localize-href";
import { localizedPathname } from "./localized-pathname";

// Derived, not hard-coded: a fork changes the catalog, and the cross-locale cases only exist while
// more than one locale is served.
const NON_DEFAULT_LOCALE = ENABLED_LOCALES.find((locale) => locale !== DEFAULT_LOCALE);

const PASS_THROUGH_HREFS = ["https://example.com/a", "//example.com/a", "settings", "#top", "?q=1"];

describe("localizeHref", () => {
  test.each(PASS_THROUGH_HREFS)("passes %s through unchanged", (href) => {
    for (const locale of ENABLED_LOCALES) {
      expect(localizeHref({ href, locale })).toBe(href);
    }
  });

  test.each(ENABLED_LOCALES)("localizes a bare path for %s with its query and hash", (locale) => {
    expect(localizeHref({ href: "/sign-in?redirect=%2Fdashboard#form", locale })).toBe(
      `${localizedPathname({ pathname: "/sign-in", locale })}?redirect=%2Fdashboard#form`,
    );
  });

  test("the default locale takes the bare path", () => {
    expect(localizeHref({ href: "/settings", locale: DEFAULT_LOCALE })).toBe("/settings");
  });

  test.skipIf(!NON_DEFAULT_LOCALE)("keeps a locale prefix the href already carries", () => {
    const href = localizedPathname({ pathname: "/settings", locale: NON_DEFAULT_LOCALE! });

    expect(localizeHref({ href, locale: DEFAULT_LOCALE })).toBe(href);
  });
});

describe("relocalizeHref", () => {
  test.each(PASS_THROUGH_HREFS)("passes %s through unchanged", (href) => {
    for (const locale of ENABLED_LOCALES) {
      expect(relocalizeHref({ href, locale })).toBe(href);
    }
  });

  // The locale switcher passes `usePathname()` plus the query and the hash; a dropped
  // `?redirect=` strands the visitor after sign-in.
  test.each(ENABLED_LOCALES)("moves a bare path under %s with its query and hash", (locale) => {
    expect(relocalizeHref({ href: "/sign-in?redirect=%2Fdashboard#form", locale })).toBe(
      `${localizedPathname({ pathname: "/sign-in", locale })}?redirect=%2Fdashboard#form`,
    );
  });

  test.skipIf(!NON_DEFAULT_LOCALE)("a non-default locale takes the prefixed path", () => {
    expect(relocalizeHref({ href: "/settings", locale: NON_DEFAULT_LOCALE! })).toBe(
      `/${NON_DEFAULT_LOCALE}/settings`,
    );
  });

  test.skipIf(!NON_DEFAULT_LOCALE)("replaces a locale prefix the href already carries", () => {
    const prefixed = localizedPathname({ pathname: "/settings", locale: NON_DEFAULT_LOCALE! });

    expect(relocalizeHref({ href: `${prefixed}?tab=1#top`, locale: DEFAULT_LOCALE })).toBe(
      `${localizedPathname({ pathname: "/settings", locale: DEFAULT_LOCALE })}?tab=1#top`,
    );
  });

  test.skipIf(!NON_DEFAULT_LOCALE)("replaces a prefix that is the whole path", () => {
    expect(relocalizeHref({ href: `/${NON_DEFAULT_LOCALE}`, locale: DEFAULT_LOCALE })).toBe(
      localizedPathname({ pathname: "/", locale: DEFAULT_LOCALE }),
    );
  });
});
