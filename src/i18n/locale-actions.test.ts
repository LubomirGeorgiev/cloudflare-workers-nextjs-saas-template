import { beforeEach, describe, expect, test, vi } from "vitest";

import { ENABLED_LOCALES, LOCALE_COOKIE_NAME } from "./config";

// Mutable cookie jar the mocked next/headers reads from and writes to, reset per test.
let cookieSets: Array<{ name: string; value: string; options: unknown }>;

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    set: (name: string, value: string, options: unknown) => {
      cookieSets.push({ name, value, options });
    },
  })),
}));

let sessionUserId: string | null;
const getSessionFromCookieMock = vi.fn(async () =>
  sessionUserId === null ? null : { user: { id: sessionUserId } },
);
vi.mock("@/utils/auth", () => ({
  getSessionFromCookie: getSessionFromCookieMock,
}));

const whereMock = vi.fn(async () => undefined);
const setMock = vi.fn(() => ({ where: whereMock }));
const updateMock = vi.fn(() => ({ set: setMock }));
const getDBMock = vi.fn(() => ({ update: updateMock }));
vi.mock("@/db", () => ({
  getDB: getDBMock,
}));

const { setUserLocale } = await import("./locale-actions");

// A locale that is actually served (setUserLocale validates against ENABLED_LOCALES,
// not the full LOCALES catalog), so this stays correct whether i18n is on or off and
// if downstream projects change the locale set.
const supportedLocale = ENABLED_LOCALES[ENABLED_LOCALES.length - 1];
const unsupportedLocale = "zz";

beforeEach(() => {
  cookieSets = [];
  sessionUserId = null;
  getSessionFromCookieMock.mockClear();
  updateMock.mockClear();
  setMock.mockClear();
  whereMock.mockClear();
  getDBMock.mockClear();
});

describe("setUserLocale", () => {
  test("persists preferredLocale to the DB for an authenticated user", async () => {
    sessionUserId = "user-1";

    await setUserLocale(supportedLocale);

    expect(cookieSets).toEqual([
      expect.objectContaining({ name: LOCALE_COOKIE_NAME, value: supportedLocale }),
    ]);
    expect(updateMock).toHaveBeenCalledOnce();
    expect(setMock).toHaveBeenCalledWith({ preferredLocale: supportedLocale });
    expect(whereMock).toHaveBeenCalledOnce();
  });

  test("sets the cookie but skips the DB write for an anonymous user", async () => {
    sessionUserId = null;

    await setUserLocale(supportedLocale);

    expect(cookieSets).toEqual([
      expect.objectContaining({ name: LOCALE_COOKIE_NAME, value: supportedLocale }),
    ]);
    expect(getDBMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("throws on an unsupported locale before writing the cookie or the DB", async () => {
    sessionUserId = "user-1";

    // @ts-expect-error intentionally invalid locale to exercise the validation guard
    await expect(setUserLocale(unsupportedLocale)).rejects.toThrow(
      "Unsupported locale",
    );

    expect(cookieSets).toEqual([]);
    expect(getDBMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
