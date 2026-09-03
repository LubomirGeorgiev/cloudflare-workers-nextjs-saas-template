import { describe, expect, test } from "vitest";

import { LOCALES } from "./config";
import { stripLocalePrefix } from "./locale-prefix";

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
