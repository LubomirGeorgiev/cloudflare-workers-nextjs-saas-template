import { describe, expect, test } from "vitest";

import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";
import { formatDate, formatDateTime } from "./format-date";

// Locale-specific wording is Intl's job, so assert the parts every locale must render rather
// than one locale's exact copy. The comparison locale is derived, so a renamed or removed
// locale skips the test instead of failing to type-check.
const ALTERNATE_LOCALE = LOCALES.find((locale) => locale !== DEFAULT_LOCALE);
const DATE = new Date("2024-06-15T12:00:00.000Z");

describe("formatDate", () => {
  test("renders the day, year, and a month name for the default locale", () => {
    const formatted = formatDate(DATE, DEFAULT_LOCALE);

    expect(formatted).toContain("15");
    expect(formatted).toContain("2024");
    expect(formatted).toMatch(/\p{L}/u);
  });

  test.skipIf(!ALTERNATE_LOCALE)("formats differently per locale", () => {
    const alternate = formatDate(DATE, ALTERNATE_LOCALE!);

    expect(alternate).toContain("15");
    expect(alternate).not.toBe(formatDate(DATE, DEFAULT_LOCALE));
  });
});

describe("formatDateTime", () => {
  test("includes the year for the default locale", () => {
    expect(formatDateTime(DATE, DEFAULT_LOCALE)).toContain("2024");
  });

  test.skipIf(!ALTERNATE_LOCALE)("formats differently per locale", () => {
    const alternate = formatDateTime(DATE, ALTERNATE_LOCALE!);

    expect(alternate).toContain("2024");
    expect(alternate).not.toBe(formatDateTime(DATE, DEFAULT_LOCALE));
  });
});
