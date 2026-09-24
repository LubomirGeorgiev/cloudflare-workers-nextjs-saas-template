import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { RegistrationResponseJSON } from "@simplewebauthn/server";

import { ENABLED_LOCALES } from "@/i18n/config";

const {
  cookieStore,
  consumeWebAuthnChallengeMock,
  createAndStoreSessionMock,
  findUserMock,
  getNewAccountLocaleMock,
  valuesMock,
} = vi.hoisted(() => {
  const returning = vi.fn(async () => [{ id: "user-1", email: "new@example.com" }]);

  return {
    cookieStore: {
      delete: vi.fn(),
      get: vi.fn(() => ({ value: "challenge-1" })),
      set: vi.fn(),
    },
    consumeWebAuthnChallengeMock: vi.fn(async () => ({ userId: "user-1" })),
    createAndStoreSessionMock: vi.fn(),
    findUserMock: vi.fn(),
    getNewAccountLocaleMock: vi.fn(),
    valuesMock: vi.fn(() => ({ returning })),
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

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
  headers: vi.fn(async () => new Headers({ "user-agent": "test-agent" })),
}));

vi.mock("@/db", () => ({
  getDB: () => ({
    insert: vi.fn(() => ({ values: valuesMock })),
    query: { userTable: { findFirst: findUserMock } },
  }),
}));

vi.mock("@/db/schema", () => ({ userTable: {} }));

vi.mock("@/utils/auth", () => ({ createAndStoreSession: createAndStoreSessionMock }));
vi.mock("@/utils/webauthn", () => ({
  generatePasskeyRegistrationOptions: vi.fn(async () => ({ challenge: "challenge-1" })),
  verifyPasskeyRegistration: vi.fn(),
}));
vi.mock("@/utils/webauthn-challenge", () => ({
  consumeWebAuthnChallenge: consumeWebAuthnChallengeMock,
  storeWebAuthnChallenge: vi.fn(),
  WEBAUTHN_CHALLENGE_PURPOSE: { SIGN_UP: "sign-up" },
  WEBAUTHN_CHALLENGE_TTL_SECONDS: 600,
}));
vi.mock("@/utils/cookie-security", () => ({ shouldUseSecureCookies: vi.fn(async () => true) }));
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

const { completePasskeyRegistrationAction, startPasskeyRegistrationAction } = await import(
  "./passkey-sign-up.actions"
);

const REGISTRATION_RESPONSE: RegistrationResponseJSON = {
  id: "credential-1",
  rawId: "credential-1",
  response: { attestationObject: "attestation", clientDataJSON: "client-data" },
  clientExtensionResults: {},
  type: "public-key",
};

describe("passkey sign-up actions", () => {
  const locale = ENABLED_LOCALES[ENABLED_LOCALES.length - 1];

  beforeEach(() => {
    getNewAccountLocaleMock.mockResolvedValue(locale);
    findUserMock.mockResolvedValue(undefined);
    createAndStoreSessionMock.mockResolvedValue({ preferredLocale: locale });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("startPasskeyRegistrationAction stores the new account locale on the user row", async () => {
    await startPasskeyRegistrationAction({
      email: "new@example.com",
      firstName: "New",
      lastName: "User",
    });

    expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({ preferredLocale: locale }));
  });

  // The client writes the locale cookie from this value; without it the cookie never exists.
  test("completePasskeyRegistrationAction returns the stored locale from the new session", async () => {
    findUserMock.mockResolvedValue({ id: "user-1", email: "new@example.com", firstName: "New" });

    await expect(
      completePasskeyRegistrationAction({ response: REGISTRATION_RESPONSE }),
    ).resolves.toEqual({ success: true, preferredLocale: locale });
    expect(createAndStoreSessionMock).toHaveBeenCalledWith("user-1", "passkey", "credential-1");
  });
});
