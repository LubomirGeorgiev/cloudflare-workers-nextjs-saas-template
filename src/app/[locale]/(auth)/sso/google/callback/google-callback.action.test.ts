import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  GOOGLE_OAUTH_CODE_VERIFIER_COOKIE_NAME,
  GOOGLE_OAUTH_LOCALE_COOKIE_NAME,
  GOOGLE_OAUTH_STATE_COOKIE_NAME,
} from "@/constants";
import { ENABLED_LOCALES } from "@/i18n/config";

const {
  cookieJar,
  cookieStoreMock,
  createAndStoreSessionMock,
  createSessionUnlessBannedMock,
  findUserMock,
  getNewAccountLocaleMock,
  insertValuesMock,
  isGoogleSSOEnabledMock,
  updateSetMock,
} = vi.hoisted(() => {
  const jar = new Map<string, string>();
  const insertReturning = vi.fn(async () => [{ id: "new-user", email: "new@example.com", emailVerified: new Date() }]);
  const updateReturning = vi.fn(async () => [{ id: "existing-user" }]);

  return {
    cookieJar: jar,
    cookieStoreMock: {
      get: vi.fn((name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined)),
      delete: vi.fn((cookie: { name: string; path?: string }) => jar.delete(cookie.name)),
    },
    createAndStoreSessionMock: vi.fn(),
    createSessionUnlessBannedMock: vi.fn(),
    findUserMock: vi.fn(),
    getNewAccountLocaleMock: vi.fn(),
    insertValuesMock: vi.fn(() => ({ returning: insertReturning })),
    isGoogleSSOEnabledMock: vi.fn(async () => true),
    updateSetMock: vi.fn(() => ({ where: () => ({ returning: updateReturning }) })),
  };
});

vi.mock("server-only", () => ({}));

const actionClientMock = {
  action: (handler: (args: { parsedInput: unknown }) => unknown) => {
    return (input?: unknown) => handler({ parsedInput: input });
  },
  inputSchema() {
    return actionClientMock;
  },
};

vi.mock("@/lib/safe-action", () => ({ actionClient: actionClientMock }));
vi.mock("next/headers", () => ({ cookies: async () => cookieStoreMock }));

vi.mock("@/db", () => ({
  getDB: () => ({
    insert: () => ({ values: insertValuesMock }),
    update: () => ({ set: updateSetMock }),
    query: { userTable: { findFirst: findUserMock } },
  }),
}));

vi.mock("@/db/schema", () => ({ userTable: { id: "id" } }));

vi.mock("@/lib/sso/google-sso", () => ({
  validateGoogleAuthorizationCode: vi.fn(async () => "id-token"),
  parseGoogleIdToken: vi.fn(() => ({
    sub: "google-sub",
    email: "new@example.com",
    email_verified: true,
    given_name: "New",
  })),
}));

vi.mock("@/utils/auth", () => ({
  createAndStoreSession: createAndStoreSessionMock,
  createSessionUnlessBanned: createSessionUnlessBannedMock,
}));
vi.mock("@/flags", () => ({ isGoogleSSOEnabled: isGoogleSSOEnabledMock }));
vi.mock("@/utils/get-IP", () => ({ getIP: vi.fn(async () => "127.0.0.1") }));
vi.mock("@/utils/email-verification", () => ({ sendUserVerificationEmail: vi.fn() }));
vi.mock("@/lib/auth/blocked-email-guard", () => ({ assertEmailNotBlocked: vi.fn() }));
vi.mock("@/lib/account/ban", () => ({ assertNotBanned: vi.fn() }));
vi.mock("@/i18n/new-account-locale", () => ({ getNewAccountLocale: getNewAccountLocaleMock }));

// The real module reads Worker bindings at import time; only the pass-through matters here.
vi.mock("@/utils/with-rate-limit", () => ({
  RATE_LIMITS: { GOOGLE_SSO_CALLBACK: { identifier: "google-sso-callback", limit: 1, windowInSeconds: 1 } },
  withRateLimit: vi.fn(async (action: () => Promise<unknown>) => action()),
}));

const { googleSSOCallbackAction } = await import("./google-callback.action");
const { validateGoogleAuthorizationCode } = await import("@/lib/sso/google-sso");

const STATE = "state-value";
const CALLBACK_INPUT = { code: "auth-code", state: STATE };
const entryLocale = ENABLED_LOCALES[ENABLED_LOCALES.length - 1];
const OAUTH_COOKIE_NAMES = [
  GOOGLE_OAUTH_STATE_COOKIE_NAME,
  GOOGLE_OAUTH_CODE_VERIFIER_COOKIE_NAME,
  GOOGLE_OAUTH_LOCALE_COOKIE_NAME,
];

function expectOAuthCookiesDeleted() {
  for (const name of OAUTH_COOKIE_NAMES) {
    expect(cookieJar.has(name)).toBe(false);
    // The route sets them on `/`; a delete on another path would leave them in the browser.
    expect(cookieStoreMock.delete).toHaveBeenCalledWith({ name, path: "/" });
  }
}

describe("googleSSOCallbackAction", () => {
  beforeEach(() => {
    cookieJar.set(GOOGLE_OAUTH_STATE_COOKIE_NAME, STATE);
    cookieJar.set(GOOGLE_OAUTH_CODE_VERIFIER_COOKIE_NAME, "verifier");
    cookieJar.set(GOOGLE_OAUTH_LOCALE_COOKIE_NAME, entryLocale);
    getNewAccountLocaleMock.mockResolvedValue(entryLocale);
    createAndStoreSessionMock.mockResolvedValue({ preferredLocale: entryLocale });
    createSessionUnlessBannedMock.mockResolvedValue({ preferredLocale: entryLocale });
  });

  afterEach(() => {
    cookieJar.clear();
    vi.clearAllMocks();
  });

  test("passes the saved entry locale to the new account and deletes the OAuth cookies", async () => {
    findUserMock.mockResolvedValue(undefined);

    await expect(googleSSOCallbackAction(CALLBACK_INPUT)).resolves.toEqual({
      success: true,
      preferredLocale: entryLocale,
    });

    expect(getNewAccountLocaleMock).toHaveBeenCalledWith({ entryLocale });
    expect(insertValuesMock).toHaveBeenCalledWith(expect.objectContaining({ preferredLocale: entryLocale }));
    expectOAuthCookiesDeleted();
  });

  // `getNewAccountLocale` owns the fallback to the request locale; its own test pins that.
  test("passes no entry locale when the cookie is missing", async () => {
    cookieJar.delete(GOOGLE_OAUTH_LOCALE_COOKIE_NAME);
    findUserMock.mockResolvedValue(undefined);

    await googleSSOCallbackAction(CALLBACK_INPUT);

    expect(getNewAccountLocaleMock).toHaveBeenCalledWith({ entryLocale: undefined });
  });

  test("leaves the stored preference of an existing Google user untouched", async () => {
    findUserMock.mockResolvedValueOnce({ id: "existing-user" });

    await googleSSOCallbackAction(CALLBACK_INPUT);

    expect(getNewAccountLocaleMock).not.toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(updateSetMock).not.toHaveBeenCalled();
    expectOAuthCookiesDeleted();
  });

  test("does not write a locale when it links Google to an existing email account", async () => {
    findUserMock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: "existing-user", avatar: null, emailVerified: null });

    await googleSSOCallbackAction(CALLBACK_INPUT);

    expect(getNewAccountLocaleMock).not.toHaveBeenCalled();
    expect(updateSetMock).toHaveBeenCalledWith(expect.not.objectContaining({ preferredLocale: expect.anything() }));
  });

  test("refuses before it reads a cookie when Google SSO is disabled", async () => {
    isGoogleSSOEnabledMock.mockResolvedValueOnce(false);

    await expect(googleSSOCallbackAction(CALLBACK_INPUT)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(cookieStoreMock.get).not.toHaveBeenCalled();
  });

  test("deletes the OAuth cookies when the code exchange fails", async () => {
    vi.mocked(validateGoogleAuthorizationCode).mockRejectedValueOnce(new Error("invalid_grant"));

    await expect(googleSSOCallbackAction(CALLBACK_INPUT)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    expectOAuthCookiesDeleted();
  });

  // A forged callback does not know the state, so it must not end a real sign-in in progress.
  test("keeps the OAuth cookies when the state does not match", async () => {
    await expect(googleSSOCallbackAction({ ...CALLBACK_INPUT, state: `${STATE}-forged` }))
      .rejects.toMatchObject({ code: "NOT_AUTHORIZED" });

    expect(cookieStoreMock.delete).not.toHaveBeenCalled();
    expect(validateGoogleAuthorizationCode).not.toHaveBeenCalled();
  });
});
