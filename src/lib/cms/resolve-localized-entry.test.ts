import { describe, expect, test, vi } from "vitest";

import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/i18n/config";

vi.mock("server-only", () => ({}));

const { resolveLocalizedEntry } = await import("./resolve-localized-entry");
const NON_DEFAULT_LOCALE = LOCALES.find((locale) => locale !== DEFAULT_LOCALE) as Locale;

describe("resolveLocalizedEntry", () => {
  test("returns the active-locale entry with isFallback=false when it exists", async () => {
    const activeEntry = { title: "Translated", locale: NON_DEFAULT_LOCALE };
    const getEntry = vi.fn(async ({ locale }: { locale: string }) =>
      locale === NON_DEFAULT_LOCALE
        ? activeEntry
        : { title: "Default", locale: DEFAULT_LOCALE }
    );

    const result = await resolveLocalizedEntry({
      locale: NON_DEFAULT_LOCALE,
      defaultLocale: DEFAULT_LOCALE,
      getEntry,
    });

    expect(result).toEqual({ entry: activeEntry, isFallback: false });
    expect(getEntry).toHaveBeenCalledTimes(1);
    expect(getEntry).toHaveBeenCalledWith({ locale: NON_DEFAULT_LOCALE });
  });

  test("falls back to the default-locale entry and flags isFallback=true when the active locale is missing", async () => {
    const defaultEntry = { title: "Default", locale: DEFAULT_LOCALE };
    const getEntry = vi.fn(async ({ locale }: { locale: string }) =>
      locale === DEFAULT_LOCALE ? defaultEntry : null
    );

    const result = await resolveLocalizedEntry({
      locale: NON_DEFAULT_LOCALE,
      defaultLocale: DEFAULT_LOCALE,
      getEntry,
    });

    expect(result).toEqual({ entry: defaultEntry, isFallback: true });
    expect(getEntry).toHaveBeenCalledTimes(2);
    expect(getEntry).toHaveBeenNthCalledWith(1, { locale: NON_DEFAULT_LOCALE });
    expect(getEntry).toHaveBeenNthCalledWith(2, { locale: DEFAULT_LOCALE });
  });

  test("returns null when neither the active nor the default locale has an entry", async () => {
    const getEntry = vi.fn(async () => null);

    const result = await resolveLocalizedEntry({
      locale: NON_DEFAULT_LOCALE,
      defaultLocale: DEFAULT_LOCALE,
      getEntry,
    });

    expect(result).toBeNull();
  });

  test("does not re-fetch when the active locale already is the default locale", async () => {
    const getEntry = vi.fn(async () => null);

    const result = await resolveLocalizedEntry({
      locale: DEFAULT_LOCALE,
      defaultLocale: DEFAULT_LOCALE,
      getEntry,
    });

    expect(result).toBeNull();
    expect(getEntry).toHaveBeenCalledTimes(1);
  });
});
