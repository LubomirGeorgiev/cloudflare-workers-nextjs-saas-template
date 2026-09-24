import { describe, expect, test } from "vitest";

import { DEFAULT_LOCALE, ENABLED_LOCALES, LOCALE_DETECTION, type Locale } from "./config";
import { localizedPathname } from "./localized-pathname";
import { decideLocaleRoute, type LocaleRouteRequest } from "./middleware";

// The routing contract in one table. Every value is derived from the served set, so a fork that
// renames or de-serves a locale still runs it.
const D = DEFAULT_LOCALE;
const ALTERNATE = ENABLED_LOCALES.find((locale) => locale !== D);
const UNSUPPORTED = "zz";

interface ExpectedRoute {
  type: "next" | "redirect" | "rewrite";
  /** Absent for `next`, which leaves the URL alone. */
  location?: string;
  locale: Locale;
}

interface RouteCase extends Partial<LocaleRouteRequest> {
  pathname: string;
  expected: ExpectedRoute;
}

function decide({ pathname, ...rest }: Partial<LocaleRouteRequest> & { pathname: string }) {
  return decideLocaleRoute({
    pathname,
    search: "",
    cookieLocale: null,
    acceptLanguage: null,
    ...rest,
  });
}

function check(routeCase: RouteCase): void {
  const { expected } = routeCase;
  const decision = decide(routeCase);

  expect(decision).toMatchObject({
    type: expected.type,
    locale: expected.locale,
    ...(expected.type === "next" ? {} : { location: expected.location }),
  });

  if (expected.type === "next") {
    expect(decision).not.toHaveProperty("location");
  }
}

describe("decideLocaleRoute", () => {
  // The default locale is served bare, so its internal path is the only rewrite target.
  test.each<RouteCase>([
    {
      pathname: "/",
      expected: { type: "rewrite", location: `/${D}`, locale: D },
    },
    {
      pathname: "/",
      acceptLanguage: D,
      expected: { type: "rewrite", location: `/${D}`, locale: D },
    },
    // A header that matches no served tag negotiates the default locale.
    {
      pathname: "/",
      acceptLanguage: UNSUPPORTED,
      expected: { type: "rewrite", location: `/${D}`, locale: D },
    },
    // A wildcard names nothing, so the default locale is served.
    {
      pathname: "/",
      acceptLanguage: "*",
      expected: { type: "rewrite", location: `/${D}`, locale: D },
    },
    {
      pathname: "/blog",
      acceptLanguage: D,
      expected: { type: "rewrite", location: `/${D}/blog`, locale: D },
    },
    {
      pathname: `/${D}/blog`,
      acceptLanguage: D,
      expected: { type: "redirect", location: "/blog", locale: D },
    },
    {
      pathname: `/${D}`,
      acceptLanguage: D,
      expected: { type: "redirect", location: "/", locale: D },
    },
    {
      pathname: `/${D}/blog`,
      search: "?tag=a",
      acceptLanguage: D,
      expected: { type: "redirect", location: "/blog?tag=a", locale: D },
    },
    // `trailingSlash` is unset, so the slash is dropped before the path is compared or prefixed.
    {
      pathname: "/blog/",
      acceptLanguage: D,
      expected: { type: "rewrite", location: `/${D}/blog`, locale: D },
    },
    {
      pathname: "/blog",
      acceptLanguage: D,
      cookieLocale: UNSUPPORTED,
      expected: { type: "rewrite", location: `/${D}/blog`, locale: D },
    },
    // A mis-cased default prefix goes straight to the canonical URL, not through `/${D}/blog`.
    {
      pathname: `/${D.toUpperCase()}/blog`,
      expected: {
        type: "redirect",
        location: localizedPathname({ pathname: "/blog", locale: D }),
        locale: D,
      },
    },
    {
      pathname: `/${D.toUpperCase()}`,
      expected: {
        type: "redirect",
        location: localizedPathname({ pathname: "/", locale: D }),
        locale: D,
      },
    },
  ])("routes $pathname to $expected.type $expected.location", check);

  // The edge HTML cache reads these two fields instead of deriving the route again.
  test.runIf(ALTERNATE !== undefined)("reports the page path and its canonical URL when it serves", () => {
    const A = ALTERNATE as Locale;

    expect(decide({ pathname: `/${A}/blog/` })).toMatchObject({
      type: "next",
      pathname: "/blog",
      canonical: localizedPathname({ pathname: "/blog", locale: A }),
    });
  });

  describe.runIf(ALTERNATE !== undefined && LOCALE_DETECTION)("with a second served locale", () => {
    const A = ALTERNATE as Locale;

    test.each<RouteCase>([
      {
        pathname: "/",
        acceptLanguage: A,
        expected: { type: "redirect", location: `/${A}`, locale: A },
      },
      {
        pathname: "/",
        acceptLanguage: `${A}-XX,${A};q=0.9,${D};q=0.8`,
        expected: { type: "redirect", location: `/${A}`, locale: A },
      },
      // The client's own ordering decides, not the order the tags appear in.
      {
        pathname: "/",
        acceptLanguage: `${D};q=0.8,${A};q=0.9`,
        expected: { type: "redirect", location: `/${A}`, locale: A },
      },
      {
        pathname: "/",
        cookieLocale: A,
        acceptLanguage: D,
        expected: { type: "redirect", location: `/${A}`, locale: A },
      },
      {
        pathname: "/",
        cookieLocale: D,
        acceptLanguage: A,
        expected: { type: "rewrite", location: `/${D}`, locale: D },
      },
      {
        pathname: "/",
        cookieLocale: UNSUPPORTED,
        acceptLanguage: A,
        expected: { type: "redirect", location: `/${A}`, locale: A },
      },
      {
        pathname: "/blog",
        acceptLanguage: A,
        expected: { type: "redirect", location: `/${A}/blog`, locale: A },
      },
      {
        pathname: "/blog",
        search: "?tag=a",
        acceptLanguage: A,
        expected: { type: "redirect", location: `/${A}/blog?tag=a`, locale: A },
      },
      // The prefix wins outright, so the page is served where it already is.
      {
        pathname: `/${A}/blog`,
        acceptLanguage: D,
        expected: { type: "next", locale: A },
      },
      {
        pathname: `/${A}/blog`,
        cookieLocale: A,
        acceptLanguage: A,
        expected: { type: "next", locale: A },
      },
      {
        pathname: `/${A}/blog/`,
        acceptLanguage: A,
        expected: { type: "next", locale: A },
      },
      // One spelling per page: a mis-cased prefix redirects to the exact one.
      {
        pathname: `/${A.toUpperCase()}/blog`,
        expected: { type: "redirect", location: `/${A}/blog`, locale: A },
      },
    ])("routes $pathname to $expected.type $expected.location", check);
  });

  // With one served locale nothing can move a request off it.
  test.runIf(!LOCALE_DETECTION)("ignores every signal but the default locale", () => {
    check({
      pathname: "/blog",
      cookieLocale: UNSUPPORTED,
      acceptLanguage: UNSUPPORTED,
      expected: { type: "rewrite", location: `/${D}/blog`, locale: D },
    });
  });

  // Security-relevant: `decodeURI` leaves an encoded backslash alone, and the WHATWG URL parser
  // silently strips TAB/LF/CR, so an unsanitized separator becomes an open redirect.
  describe("sanitization", () => {
    test("re-encodes a decoded backslash instead of letting it start a host", () => {
      expect(decide({ pathname: "/%5C%5Cexample.org" })).toMatchObject({
        type: "rewrite",
        location: `/${D}/%5C%5Cexample.org`,
      });
    });

    test.each([
      ["a stripped TAB", "/%09/example.org"],
      ["consecutive slashes", "//example.org"],
    ])("collapses %s into a single in-app path", (_label, pathname) => {
      expect(decide({ pathname })).toMatchObject({
        type: "rewrite",
        location: `/${D}/example.org`,
      });
    });

    test("hands an undecodable pathname back to Next untouched", () => {
      expect(decide({ pathname: "/%E0%A4%A" })).toBeNull();
    });
  });
});
