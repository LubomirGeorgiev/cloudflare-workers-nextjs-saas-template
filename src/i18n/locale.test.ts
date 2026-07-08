import { beforeEach, describe, expect, test, vi } from "vitest";

import { DEFAULT_LOCALE, ENABLED_LOCALES } from "./config";

// Mutable stores the mocked next/headers reads from, reset per test.
let cookieValue: string | undefined;
let acceptLanguage: string | null;

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      cookieValue === undefined ? undefined : { name, value: cookieValue },
  })),
  headers: vi.fn(async () => ({
    get: (name: string) =>
      name.toLowerCase() === "accept-language" ? acceptLanguage : null,
  })),
}));

let preferredLocale: string | null;
vi.mock("@/utils/auth", () => ({
  getSessionFromCookie: vi.fn(async () =>
    preferredLocale === undefined ? null : { user: { preferredLocale } },
  ),
}));

const { getUserLocale } = await import("./locale");

// A served locale and one that is not, derived from the enabled list so this stays
// correct if downstream projects change LOCALES. When i18n is disabled the enabled
// set is just the default, so `supportedLocale` collapses to it and getUserLocale
// (which short-circuits to the default) still satisfies every expectation below.
const supportedLocale = ENABLED_LOCALES[ENABLED_LOCALES.length - 1];
const unsupportedLocale = "zz";

beforeEach(() => {
  cookieValue = undefined;
  acceptLanguage = null;
  preferredLocale = null;
});

describe("getUserLocale", () => {
  test("prefers a valid locale cookie over the header", async () => {
    cookieValue = supportedLocale;
    acceptLanguage = `${DEFAULT_LOCALE};q=0.9`;

    await expect(getUserLocale()).resolves.toBe(supportedLocale);
  });

  test("ignores an unsupported cookie and negotiates the header", async () => {
    cookieValue = unsupportedLocale;
    acceptLanguage = `${supportedLocale}-XX,${supportedLocale};q=0.9`;

    await expect(getUserLocale()).resolves.toBe(supportedLocale);
  });

  test("negotiates the highest-quality supported language from the header", async () => {
    acceptLanguage = `${unsupportedLocale};q=1.0, ${supportedLocale};q=0.7`;

    await expect(getUserLocale()).resolves.toBe(supportedLocale);
  });

  test("falls back to the default locale when nothing matches", async () => {
    acceptLanguage = `${unsupportedLocale}-XX,${unsupportedLocale};q=0.9`;

    await expect(getUserLocale()).resolves.toBe(DEFAULT_LOCALE);
  });

  test("falls back to the default locale with no cookie or header", async () => {
    await expect(getUserLocale()).resolves.toBe(DEFAULT_LOCALE);
  });

  test("uses the authenticated user's preferredLocale when no cookie is set", async () => {
    preferredLocale = supportedLocale;
    acceptLanguage = `${DEFAULT_LOCALE};q=0.9`;
    await expect(getUserLocale()).resolves.toBe(supportedLocale);
  });

  test("cookie still wins over the user preference", async () => {
    cookieValue = DEFAULT_LOCALE;
    preferredLocale = supportedLocale;
    await expect(getUserLocale()).resolves.toBe(DEFAULT_LOCALE);
  });
});
