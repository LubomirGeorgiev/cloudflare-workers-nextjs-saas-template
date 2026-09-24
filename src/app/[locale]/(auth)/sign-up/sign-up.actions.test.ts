import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ENABLED_LOCALES } from "@/i18n/config";

const {
  createAndStoreSessionMock,
  findUserMock,
  getNewAccountLocaleMock,
  insertMock,
  valuesMock,
} = vi.hoisted(() => {
  const returning = vi.fn(async () => [{ id: "user-1", email: "new@example.com", firstName: "New" }]);
  const values = vi.fn(() => ({ returning }));

  return {
    createAndStoreSessionMock: vi.fn(),
    findUserMock: vi.fn(async () => undefined),
    getNewAccountLocaleMock: vi.fn(),
    insertMock: vi.fn(() => ({ values })),
    valuesMock: values,
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

vi.mock("@/db", () => ({
  getDB: () => ({
    insert: insertMock,
    query: { userTable: { findFirst: findUserMock } },
  }),
}));

vi.mock("@/db/schema", () => ({ userTable: {} }));

vi.mock("@/utils/auth", () => ({ createAndStoreSession: createAndStoreSessionMock }));
vi.mock("@/utils/password-hasher", () => ({ hashPassword: vi.fn(async () => "hash") }));
vi.mock("@/utils/email-verification", () => ({ sendUserVerificationEmail: vi.fn() }));
vi.mock("@/utils/get-IP", () => ({ getIP: vi.fn(async () => "127.0.0.1") }));
vi.mock("@/utils/validate-captcha", () => ({ validateTurnstileToken: vi.fn(async () => true) }));
vi.mock("@/flags", () => ({ isTurnstileEnabled: vi.fn(async () => false) }));
vi.mock("@/lib/auth/blocked-email-guard", () => ({ assertEmailNotBlocked: vi.fn() }));
vi.mock("@/i18n/new-account-locale", () => ({ getNewAccountLocale: getNewAccountLocaleMock }));

// The real module reads Worker bindings at import time; only the pass-through matters here.
vi.mock("@/utils/with-rate-limit", () => ({
  RATE_LIMITS: { SIGN_UP: { identifier: "sign-up", limit: 1, windowInSeconds: 1 } },
  withRateLimit: vi.fn(async (action: () => Promise<unknown>) => action()),
}));

const { signUpAction } = await import("./sign-up.actions");

const SIGN_UP_INPUT = {
  email: "new@example.com",
  firstName: "New",
  lastName: "User",
  password: "password123",
};

describe("signUpAction", () => {
  const locale = ENABLED_LOCALES[ENABLED_LOCALES.length - 1];

  beforeEach(() => {
    getNewAccountLocaleMock.mockResolvedValue(locale);
    createAndStoreSessionMock.mockResolvedValue({ preferredLocale: locale });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("stores the new account locale on the user row", async () => {
    await signUpAction(SIGN_UP_INPUT);

    expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({ preferredLocale: locale }));
  });

  // The client writes the locale cookie from this value; without it the cookie never exists.
  test("returns the stored locale from the new session", async () => {
    await expect(signUpAction(SIGN_UP_INPUT)).resolves.toEqual({
      success: true,
      preferredLocale: locale,
    });
    expect(createAndStoreSessionMock).toHaveBeenCalledWith("user-1", "password");
  });
});
