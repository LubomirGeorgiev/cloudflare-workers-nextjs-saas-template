import { afterEach, describe, expect, test, vi } from "vitest";

import {
  ENABLED_LOCALES,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
} from "./config";

const { setUserLocaleActionMock } = vi.hoisted(() => ({
  setUserLocaleActionMock: vi.fn(),
}));

vi.mock("./locale-actions", () => ({
  setUserLocaleAction: setUserLocaleActionMock,
}));

const { enterLocale, persistUserLocale } = await import("./locale-cookie.client");

function expectedCookie(locale: string): string {
  return `${LOCALE_COOKIE_NAME}=${encodeURIComponent(locale)}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("enterLocale", () => {
  // The new document's request must carry the new cookie, or the proxy reads the old choice.
  test("writes the cookie before it loads the new document", () => {
    const documentMock = { cookie: `${LOCALE_COOKIE_NAME}=previous` };
    const locale = ENABLED_LOCALES[0];
    const href = "/settings?tab=profile#top";
    const assign = vi.fn(() => {
      expect(documentMock.cookie).toBe(expectedCookie(locale));
    });
    vi.stubGlobal("document", documentMock);
    vi.stubGlobal("window", { location: { assign } });

    enterLocale({ locale, href });

    expect(assign).toHaveBeenCalledWith(href);
    expect(documentMock.cookie).toBe(expectedCookie(locale));
  });
});

// The action POST targets the old URL, so the save must not write the cookie; `enterLocale` does.
describe("persistUserLocale", () => {
  test("saves the preference and leaves the cookie alone", async () => {
    const previousCookie = `${LOCALE_COOKIE_NAME}=previous`;
    const documentMock = { cookie: previousCookie };
    const locale = ENABLED_LOCALES[0];
    vi.stubGlobal("document", documentMock);
    setUserLocaleActionMock.mockResolvedValueOnce({ data: { success: true } });

    await persistUserLocale(locale);

    expect(setUserLocaleActionMock).toHaveBeenCalledWith({ locale });
    expect(documentMock.cookie).toBe(previousCookie);
  });

  test("throws when the action refuses the write", async () => {
    const locale = ENABLED_LOCALES[0];
    setUserLocaleActionMock.mockResolvedValueOnce({
      serverError: { code: "RATE_LIMITED", message: "Too many requests" },
    });

    await expect(persistUserLocale(locale)).rejects.toThrow("Too many requests");
  });

  test("throws when the action returns validation errors", async () => {
    const locale = ENABLED_LOCALES[0];
    setUserLocaleActionMock.mockResolvedValueOnce({
      validationErrors: { locale: { _errors: ["Invalid locale"] } },
    });

    await expect(persistUserLocale(locale)).rejects.toThrow();
  });

  test("throws when the action returns no data", async () => {
    const locale = ENABLED_LOCALES[0];
    setUserLocaleActionMock.mockResolvedValueOnce({});

    await expect(persistUserLocale(locale)).rejects.toThrow();
  });

  test("rethrows the error when the action rejects", async () => {
    const locale = ENABLED_LOCALES[0];
    const failure = new Error("Network down");
    setUserLocaleActionMock.mockRejectedValueOnce(failure);

    await expect(persistUserLocale(locale)).rejects.toBe(failure);
  });
});
