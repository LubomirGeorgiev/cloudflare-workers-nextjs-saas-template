import { describe, expect, test } from "vitest";

import { DEFAULT_LOCALE, ENABLED_LOCALES, LOCALES } from "./config";
import { splitLocalePrefix, stripLocalePrefix } from "./locale-prefix";

describe("stripLocalePrefix", () => {
  test.each(LOCALES)("strips the %s prefix from the root and a nested path", (locale) => {
    expect(stripLocalePrefix(`/${locale}`)).toBe("/");
    expect(stripLocalePrefix(`/${locale}/blog/post`)).toBe("/blog/post");
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

describe("splitLocalePrefix", () => {
  test.each(ENABLED_LOCALES)("splits the %s prefix off the root and a nested path", (locale) => {
    expect(splitLocalePrefix(`/${locale}`)).toEqual({ locale, pathname: "/" });
    expect(splitLocalePrefix(`/${locale}/blog/post`)).toEqual({
      locale,
      pathname: "/blog/post",
    });
  });

  test("reads a bare path as the default locale", () => {
    expect(splitLocalePrefix("/blog")).toEqual({ locale: DEFAULT_LOCALE, pathname: "/blog" });
  });

  test("does not treat a segment that merely starts with a locale as a prefix", () => {
    const [locale] = ENABLED_LOCALES;
    expect(splitLocalePrefix(`/${locale}terprise`)).toEqual({
      locale: DEFAULT_LOCALE,
      pathname: `/${locale}terprise`,
    });
  });
});
