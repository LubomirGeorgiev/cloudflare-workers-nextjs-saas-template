import { afterEach, describe, expect, test, vi } from "vitest";

import {
  ENABLED_LOCALES,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
} from "./config";

const { setUserLocaleMock } = vi.hoisted(() => ({
  setUserLocaleMock: vi.fn(),
}));

vi.mock("./locale-actions", () => ({
  setUserLocale: setUserLocaleMock,
}));

const { persistUserLocale } = await import("./locale-cookie.client");

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("persistUserLocale", () => {
  test("writes the browser cookie after the server action returns", async () => {
    const previousCookie = `${LOCALE_COOKIE_NAME}=previous`;
    const documentMock = { cookie: previousCookie };
    const locale = ENABLED_LOCALES[0];
    vi.stubGlobal("document", documentMock);
    setUserLocaleMock.mockImplementationOnce(async () => {
      expect(documentMock.cookie).toBe(previousCookie);
    });

    await persistUserLocale(locale);

    expect(setUserLocaleMock).toHaveBeenCalledWith(locale);
    expect(documentMock.cookie).toBe(
      `${LOCALE_COOKIE_NAME}=${encodeURIComponent(locale)}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`,
    );
  });
});
