import { describe, expect, test } from "vitest";

import { DEFAULT_LOCALE, ENABLED_LOCALES, LOCALES } from "./config";
import { matchLocalePrefix, splitLocalePrefix, stripLocalePrefix } from "./locale-prefix";

describe("stripLocalePrefix", () => {
  test.each(LOCALES)("strips the %s prefix from the root and a nested path", (locale) => {
    expect(stripLocalePrefix(`/${locale}`)).toBe("/");
    expect(stripLocalePrefix(`/${locale}/blog/post`)).toBe("/blog/post");
  });

  test.each(LOCALES)("strips a mis-cased %s prefix and keeps the case of the rest", (locale) => {
    expect(stripLocalePrefix(`/${locale.toUpperCase()}/Blog`)).toBe("/Blog");
  });

  test("leaves a bare path alone", () => {
    expect(stripLocalePrefix("/")).toBeNull();
    expect(stripLocalePrefix("/blog")).toBeNull();
  });

  test("does not treat a segment that merely starts with a locale as a prefix", () => {
    const [locale] = LOCALES;
    expect(stripLocalePrefix(`/${locale}terprise`)).toBeNull();
  });
});

describe("matchLocalePrefix", () => {
  test.each(ENABLED_LOCALES)("matches the %s prefix on the root and a nested path", (locale) => {
    expect(matchLocalePrefix(`/${locale}`)).toEqual({ locale, pathname: "/" });
    expect(matchLocalePrefix(`/${locale}/blog/post`)).toEqual({ locale, pathname: "/blog/post" });
  });

  // The middleware redirects a mis-cased prefix to its one spelling, so it must still name a locale.
  test.each(ENABLED_LOCALES)("matches a mis-cased %s prefix", (locale) => {
    expect(matchLocalePrefix(`/${locale.toUpperCase()}/blog`)).toEqual({
      locale,
      pathname: "/blog",
    });
  });

  test.each(LOCALES.filter((locale) => !ENABLED_LOCALES.includes(locale)))(
    "misses the de-served %s prefix",
    (locale) => {
      expect(matchLocalePrefix(`/${locale}/blog`)).toBeNull();
    },
  );

  test("misses a bare path and a segment that merely starts with a locale", () => {
    const [locale] = ENABLED_LOCALES;
    expect(matchLocalePrefix("/blog")).toBeNull();
    expect(matchLocalePrefix(`/${locale}terprise`)).toBeNull();
  });
});

describe("splitLocalePrefix", () => {
  test.each(ENABLED_LOCALES)("splits the %s prefix off a nested path", (locale) => {
    expect(splitLocalePrefix(`/${locale}/blog`)).toEqual({ locale, pathname: "/blog" });
  });

  test("reads a bare path as the default locale", () => {
    expect(splitLocalePrefix("/blog")).toEqual({ locale: DEFAULT_LOCALE, pathname: "/blog" });
  });
});
