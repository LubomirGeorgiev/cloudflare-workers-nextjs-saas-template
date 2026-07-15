import { beforeEach, describe, expect, test, vi } from "vitest";

import { ENABLED_LOCALES } from "./config";

vi.mock("server-only", () => ({}));

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

    expect(updateMock).toHaveBeenCalledOnce();
    expect(setMock).toHaveBeenCalledWith({ preferredLocale: supportedLocale });
    expect(whereMock).toHaveBeenCalledOnce();
  });

  test("skips the DB write for an anonymous user", async () => {
    sessionUserId = null;

    await setUserLocale(supportedLocale);

    expect(getDBMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("throws on an unsupported locale before reading the session or DB", async () => {
    sessionUserId = "user-1";

    // @ts-expect-error intentionally invalid locale to exercise the validation guard
    await expect(setUserLocale(unsupportedLocale)).rejects.toThrow(
      "Unsupported locale",
    );

    expect(getSessionFromCookieMock).not.toHaveBeenCalled();
    expect(getDBMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
