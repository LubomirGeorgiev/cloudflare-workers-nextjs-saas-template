import { describe, expect, test } from "vitest";

import { I18N_ENABLED } from "@/constants";

import { DEFAULT_LOCALE, ENABLED_LOCALES, type Locale } from "./config";
import { buildLocaleHref } from "./locale-href";

// Derived, not hard-coded: a fork changes the catalog, and the prefixed cases only
// exist while i18n stays enabled.
const NON_DEFAULT_LOCALE = ENABLED_LOCALES.find(
  (locale) => locale !== DEFAULT_LOCALE,
) as Locale;

describe("buildLocaleHref", () => {
  test("the default locale takes the bare path", () => {
    expect(
      buildLocaleHref({
        pathname: "/settings",
        locale: DEFAULT_LOCALE,
        search: "",
        hash: "",
      }),
    ).toBe("/settings");
  });

  test("keeps the query and the hash", () => {
    expect(
      buildLocaleHref({
        pathname: "/sign-in",
        locale: DEFAULT_LOCALE,
        search: "?redirect=%2Fdashboard",
        hash: "#form",
      }),
    ).toBe("/sign-in?redirect=%2Fdashboard#form");
  });
});

describe.skipIf(!I18N_ENABLED)("buildLocaleHref with i18n enabled", () => {
  test("a non-default locale takes the prefixed path", () => {
    expect(
      buildLocaleHref({
        pathname: "/settings",
        locale: NON_DEFAULT_LOCALE,
        search: "",
        hash: "",
      }),
    ).toBe(`/${NON_DEFAULT_LOCALE}/settings`);
  });

  test("a non-default locale keeps the query and the hash", () => {
    expect(
      buildLocaleHref({
        pathname: "/sign-in",
        locale: NON_DEFAULT_LOCALE,
        search: "?redirect=%2Fdashboard",
        hash: "#form",
      }),
    ).toBe(`/${NON_DEFAULT_LOCALE}/sign-in?redirect=%2Fdashboard#form`);
  });
});
