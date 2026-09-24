import { beforeEach, describe, expect, test, vi } from "vitest";

import { DEFAULT_LOCALE, ENABLED_LOCALES, LOCALE_DETECTION, LOCALE_HEADER_NAME } from "./config";

// Mutable stores the mocked next/headers reads from, reset per test.
let cookieValue: string | undefined;
let acceptLanguage: string | null;
let forwardedLocale: string | null;

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      cookieValue === undefined ? undefined : { name, value: cookieValue },
  })),
  headers: vi.fn(async () => ({
    get: (name: string) => {
      const lowerName = name.toLowerCase();
      if (lowerName === LOCALE_HEADER_NAME) {
        return forwardedLocale;
      }

      return lowerName === "accept-language" ? acceptLanguage : null;
    },
  })),
}));

// `undefined` means no session at all; `null` means a signed-in user with no stored preference.
let preferredLocale: string | null | undefined;
const { getCurrentSessionMock } = vi.hoisted(() => ({ getCurrentSessionMock: vi.fn() }));
vi.mock("@/utils/auth", () => ({
  getCurrentSession: getCurrentSessionMock,
}));

const { getUserLocale } = await import("./locale");

// A served locale and one that is not, derived from the enabled list so this stays correct if downstream
// projects change LOCALES. When i18n is disabled the enabled set is just the default, so `supportedLocale`
// collapses to it and getUserLocale (which short-circuits to the default) still satisfies every expectation below.
const supportedLocale = ENABLED_LOCALES[ENABLED_LOCALES.length - 1];
const unsupportedLocale = "zz";
// A second served locale when there is one, so "cookie beats preference" compares two different values.
const otherLocale = ENABLED_LOCALES.find((locale) => locale !== supportedLocale) ?? DEFAULT_LOCALE;

beforeEach(() => {
  cookieValue = undefined;
  acceptLanguage = null;
  forwardedLocale = null;
  preferredLocale = null;
  getCurrentSessionMock.mockReset();
  getCurrentSessionMock.mockImplementation(async () =>
    preferredLocale === undefined ? null : { user: { preferredLocale } },
  );
});

describe("getUserLocale", () => {
  // The URL the visitor is on beats the cookie, so an email sent from `/es/sign-up` is Spanish.
  test.runIf(LOCALE_DETECTION)("the forwarded URL locale wins over the cookie", async () => {
    forwardedLocale = supportedLocale;
    cookieValue = otherLocale;
    preferredLocale = otherLocale;
    acceptLanguage = `${otherLocale};q=0.9`;

    await expect(getUserLocale()).resolves.toBe(supportedLocale);
    expect(getCurrentSessionMock).not.toHaveBeenCalled();
  });

  test("ignores a forwarded locale the app does not serve", async () => {
    forwardedLocale = unsupportedLocale;
    cookieValue = supportedLocale;

    await expect(getUserLocale()).resolves.toBe(supportedLocale);
  });

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

  test("uses the stored preference when no cookie is set", async () => {
    preferredLocale = supportedLocale;
    acceptLanguage = `${DEFAULT_LOCALE};q=0.9`;
    await expect(getUserLocale()).resolves.toBe(supportedLocale);
  });

  // The cookie is this device's latest choice; the stored preference may predate it.
  test("the cookie wins over the stored preference", async () => {
    cookieValue = supportedLocale;
    preferredLocale = otherLocale;
    await expect(getUserLocale()).resolves.toBe(supportedLocale);
  });

  test("reads the stored preference when the cookie is unsupported", async () => {
    cookieValue = unsupportedLocale;
    preferredLocale = supportedLocale;
    acceptLanguage = `${DEFAULT_LOCALE};q=0.9`;
    await expect(getUserLocale()).resolves.toBe(supportedLocale);
  });

  test("ignores an unsupported stored preference and negotiates the header", async () => {
    preferredLocale = unsupportedLocale;
    acceptLanguage = `${supportedLocale};q=0.9`;
    await expect(getUserLocale()).resolves.toBe(supportedLocale);
  });

  test("never reads the session when the cookie decides", async () => {
    cookieValue = supportedLocale;
    preferredLocale = otherLocale;
    await getUserLocale();
    expect(getCurrentSessionMock).not.toHaveBeenCalled();
  });

  test("an anonymous visitor with no cookie gets the header", async () => {
    preferredLocale = undefined;
    acceptLanguage = `${supportedLocale};q=0.9`;
    await expect(getUserLocale()).resolves.toBe(supportedLocale);
  });
});
