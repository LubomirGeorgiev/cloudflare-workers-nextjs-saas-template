import { afterEach, describe, expect, test, vi } from "vitest";

import { ENABLED_LOCALES, LOCALES } from "./config";

const { getLocaleMock } = vi.hoisted(() => ({ getLocaleMock: vi.fn() }));

vi.mock("server-only", () => ({}));

vi.mock("./server", () => ({ getLocale: getLocaleMock }));

const { getNewAccountLocale } = await import("./new-account-locale");

// Not a served locale, so a result equal to it proves the request locale was the source.
const REQUEST_LOCALE_SENTINEL = "request-locale";

// Catalog locales the template does not serve; empty unless single-locale mode is on.
const UNSERVED_LOCALES = LOCALES.filter((locale) => !ENABLED_LOCALES.includes(locale));

describe("getNewAccountLocale", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test.each(ENABLED_LOCALES)("stores the request locale %s for a new account", async (locale) => {
    getLocaleMock.mockResolvedValue(locale);

    await expect(getNewAccountLocale()).resolves.toBe(locale);
  });

  test.each(ENABLED_LOCALES)("prefers the entry locale %s over the request locale", async (locale) => {
    getLocaleMock.mockResolvedValue(REQUEST_LOCALE_SENTINEL);

    await expect(getNewAccountLocale({ entryLocale: locale })).resolves.toBe(locale);
    expect(getLocaleMock).not.toHaveBeenCalled();
  });

  test.each([undefined, null, "", "xx-not-a-locale"])(
    "falls back to the request locale when the entry locale is %j",
    async (entryLocale) => {
      getLocaleMock.mockResolvedValue(REQUEST_LOCALE_SENTINEL);

      await expect(getNewAccountLocale({ entryLocale })).resolves.toBe(REQUEST_LOCALE_SENTINEL);
    }
  );

  test.skipIf(UNSERVED_LOCALES.length === 0)(
    "falls back to the request locale when the entry locale is not served",
    async () => {
      getLocaleMock.mockResolvedValue(REQUEST_LOCALE_SENTINEL);

      for (const entryLocale of UNSERVED_LOCALES) {
        await expect(getNewAccountLocale({ entryLocale })).resolves.toBe(REQUEST_LOCALE_SENTINEL);
      }
    }
  );
});
