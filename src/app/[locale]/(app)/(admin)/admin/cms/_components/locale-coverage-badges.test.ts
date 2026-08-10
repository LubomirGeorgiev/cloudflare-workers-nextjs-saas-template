import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { ENABLED_LOCALES, LOCALE_LABELS } from "@/i18n/config";

import { LocaleCoverageBadges } from "./locale-coverage-badges";

describe("LocaleCoverageBadges", () => {
  test("marks the current row locale inside translation coverage", () => {
    const currentLocale = ENABLED_LOCALES[0];
    const html = renderToStaticMarkup(
      LocaleCoverageBadges({
        translatedLocales: new Set([currentLocale]),
        currentLocale,
      })
    );

    expect(html).toContain(`${LOCALE_LABELS[currentLocale]}: current translation`);
    expect(html).toContain(currentLocale);
    expect(html).toContain("current");
  });

  test.skipIf(ENABLED_LOCALES.length < 2)(
    "marks enabled locales without translations as missing",
    () => {
      const currentLocale = ENABLED_LOCALES[0];
      const missingLocale = ENABLED_LOCALES.find(
        (locale) => locale !== currentLocale
      );

      expect(missingLocale).toBeDefined();

      const html = renderToStaticMarkup(
        LocaleCoverageBadges({
          translatedLocales: new Set([currentLocale]),
          currentLocale,
        })
      );

      expect(html).toContain(`${LOCALE_LABELS[missingLocale!]}: missing translation`);
      expect(html).toContain(">missing<");
    }
  );
});
