import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ENABLED_LOCALES } from "@/i18n/config";
import type { SessionRecheckState } from "@/utils/session-user";

const {
  andMock,
  createSessionUnlessBannedMock,
  eqMock,
  findPasskeyMock,
  findUserMock,
  hashPasswordMock,
  hashTokenMock,
  returningMock,
  setMock,
  updateMock,
  verifyPasswordMock,
  whereMock,
  withRateLimitMock,
} = vi.hoisted(() => {
  const returning = vi.fn();
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  return {
    andMock: vi.fn((...conditions: unknown[]) => ({ conditions })),
    createSessionUnlessBannedMock: vi.fn(),
    eqMock: vi.fn((column: unknown, value: unknown) => ({ column, value })),
    findPasskeyMock: vi.fn(),
    findUserMock: vi.fn(),
    hashPasswordMock: vi.fn(),
    hashTokenMock: vi.fn(),
    returningMock: returning,
    setMock: set,
    updateMock: update,
    verifyPasswordMock: vi.fn(),
    whereMock: where,
    withRateLimitMock: vi.fn((action: () => Promise<unknown>) => action()),
  };
});

vi.mock("server-only", () => ({}));

vi.mock("drizzle-orm", () => ({
  and: andMock,
  eq: eqMock,
}));

vi.mock("@/db", () => ({
  getDB: () => ({
    query: {
      passKeyCredentialTable: {
        findFirst: findPasskeyMock,
      },
      userTable: {
        findFirst: findUserMock,
      },
    },
    update: updateMock,
  }),
}));

vi.mock("@/db/schema", () => ({
  userTable: {
    id: "user.id",
    passwordHash: "user.passwordHash",
  },
}));

vi.mock("@/utils/auth", () => ({
  createSessionUnlessBanned: createSessionUnlessBannedMock,
}));

vi.mock("@/utils/password-hasher", () => ({
  hashPassword: hashPasswordMock,
  verifyPassword: verifyPasswordMock,
}));

vi.mock("@/utils/random-token", () => ({
  hashToken: hashTokenMock,
}));

vi.mock("@/utils/with-rate-limit", () => ({
  RATE_LIMITS: {
    SIGN_IN: {
      identifier: "sign-in",
      limit: 15,
      windowInSeconds: 3_600,
    },
    SIGN_IN_ACCOUNT: {
      identifier: "sign-in-account",
      limit: 10,
      windowInSeconds: 3_600,
    },
  },
  withRateLimit: withRateLimitMock,
}));

const { signInWithPassword } = await import("./sign-in-auth");

const LEGACY_HASH =
  "00112233445566778899aabbccddeeff:74910295e41874e5826df4cff58a5284ec96d7fa21a38bc368f0be9b638ee303";
const CURRENT_HASH = "pbkdf2-sha256$100000$salt$current";
const RESET_HASH = "pbkdf2-sha256$100000$salt$reset";
const WINNER_HASH = "pbkdf2-sha256$100000$winner-salt$winner";

describe("signInWithPassword", () => {
  beforeEach(() => {
    findUserMock.mockResolvedValue({
      googleAccountId: null,
      id: "user-1",
      passwordHash: CURRENT_HASH,
    });
    findPasskeyMock.mockResolvedValue(null);
    createSessionUnlessBannedMock.mockResolvedValue({ preferredLocale: null });
    hashPasswordMock.mockResolvedValue("pbkdf2-sha256$100000$new-salt$new-hash");
    hashTokenMock.mockResolvedValue("email-digest");
    verifyPasswordMock.mockResolvedValue({
      isValid: true,
      needsRehash: false,
      scheme: "pbkdf2-sha256",
    });
    returningMock.mockResolvedValue([{ id: "user-1" }]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("applies IP and pseudonymous account limits before authenticating", async () => {
    await signInWithPassword({
      email: " User@Example.COM ",
      password: "legacy-password",
    });

    expect(hashTokenMock).toHaveBeenCalledWith("user@example.com");

    // Observe the actual DB query identity: the lookup must key off the same canonical email as
    // the rate-limit bucket, and compare case-insensitively so legacy mixed-case rows still match.
    const [userQuery] = findUserMock.mock.calls[0];
    const sqlSpy = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings: Array.from(strings),
      values,
    }));
    const predicate = userQuery.where.RAW({ email: "user.email" }, { sql: sqlSpy });
    expect(predicate.values).toContain("user@example.com");
    expect(predicate.values).not.toContain(" User@Example.COM ");
    expect(predicate.strings.join("?").toLowerCase()).toContain("lower(");

    expect(withRateLimitMock).toHaveBeenNthCalledWith(
      1,
      expect.any(Function),
      {
        identifier: "sign-in",
        limit: 15,
        windowInSeconds: 3_600,
      },
    );
    expect(withRateLimitMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Function),
      {
        identifier: "sign-in-account",
        limit: 10,
        userIdentifier: "account:email-digest",
        windowInSeconds: 3_600,
        resetOnSuccess: true,
      },
    );
    expect(findUserMock).toHaveBeenCalledOnce();
  });

  test("returns the locale the session write read from the account", async () => {
    const preferredLocale = ENABLED_LOCALES[ENABLED_LOCALES.length - 1];
    createSessionUnlessBannedMock.mockResolvedValue({ preferredLocale });

    await expect(signInWithPassword({
      email: "user@example.com",
      password: "current-password",
    })).resolves.toEqual({ success: true, preferredLocale });
  });

  test("does not rewrite a current password hash", async () => {
    await signInWithPassword({
      email: "user@example.com",
      password: "current-password",
    });

    expect(hashPasswordMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(createSessionUnlessBannedMock).toHaveBeenCalledWith({
      userId: "user-1",
      authenticationType: "password",
      recheck: expect.any(Function),
    });
  });

  test("upgrades a valid legacy hash with a compare-and-set update", async () => {
    findUserMock.mockResolvedValue({
      googleAccountId: null,
      id: "user-1",
      passwordHash: LEGACY_HASH,
    });
    verifyPasswordMock.mockResolvedValue({
      isValid: true,
      needsRehash: true,
      scheme: "legacy-pbkdf2-sha256",
    });

    await signInWithPassword({
      email: "user@example.com",
      password: "legacy-password",
    });

    expect(hashPasswordMock).toHaveBeenCalledWith({ password: "legacy-password" });
    expect(setMock).toHaveBeenCalledWith({
      passwordHash: "pbkdf2-sha256$100000$new-salt$new-hash",
    });
    expect(eqMock).toHaveBeenNthCalledWith(1, "user.id", "user-1");
    expect(eqMock).toHaveBeenNthCalledWith(2, "user.passwordHash", LEGACY_HASH);
    expect(andMock).toHaveBeenCalledWith(
      { column: "user.id", value: "user-1" },
      { column: "user.passwordHash", value: LEGACY_HASH },
    );
    expect(whereMock).toHaveBeenCalledOnce();
    expect(createSessionUnlessBannedMock).toHaveBeenCalledWith({
      userId: "user-1",
      authenticationType: "password",
      recheck: expect.any(Function),
    });
  });

  test("does not upgrade or create a session for an invalid password", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    verifyPasswordMock.mockResolvedValue({
      isValid: false,
      needsRehash: false,
      scheme: "pbkdf2-sha256",
    });

    await expect(signInWithPassword({
      email: "user@example.com",
      password: "wrong-password",
    })).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
      messageKey: "Client.Auth.SignIn.errorInvalidCredentials",
    });

    expect(hashPasswordMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(createSessionUnlessBannedMock).not.toHaveBeenCalled();
    // Expected ActionError failures must not be logged as unexpected errors.
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  test.each([
    {
      name: "a wrong password",
      user: { googleAccountId: null, id: "user-1", passwordHash: CURRENT_HASH },
      isValid: false,
    },
    { name: "a missing account", user: undefined, isValid: true },
    {
      name: "a Google-only account",
      user: { googleAccountId: "google-1", id: "user-1", passwordHash: null },
      isValid: true,
    },
    {
      name: "an account without a password",
      user: { googleAccountId: null, id: "user-1", passwordHash: null },
      isValid: true,
    },
  ])("rejects $name with the generic error after one password verification", async ({
    user,
    isValid,
  }) => {
    findUserMock.mockResolvedValue(user);
    // A dummy verification that matches must still reject.
    verifyPasswordMock.mockResolvedValue({ isValid, needsRehash: false, scheme: "pbkdf2-sha256" });

    await expect(signInWithPassword({
      email: "user@example.com",
      password: "attempt",
    })).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
      messageKey: "Client.Auth.SignIn.errorInvalidCredentials",
    });

    expect(verifyPasswordMock).toHaveBeenCalledOnce();
    expect(verifyPasswordMock).toHaveBeenCalledWith({
      storedHash: user?.passwordHash ?? "pbkdf2-sha256$100000$new-salt$new-hash",
      passwordAttempt: "attempt",
    });
    expect(updateMock).not.toHaveBeenCalled();
    expect(createSessionUnlessBannedMock).not.toHaveBeenCalled();
  });

  test("does not upgrade a password when passkey sign-in is required", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    verifyPasswordMock.mockResolvedValue({
      isValid: true,
      needsRehash: true,
      scheme: "legacy-pbkdf2-sha256",
    });
    findPasskeyMock.mockResolvedValue({ id: "passkey-1" });

    await expect(signInWithPassword({
      email: "user@example.com",
      password: "legacy-password",
    })).rejects.toMatchObject({
      code: "FORBIDDEN",
      messageKey: "Client.Auth.SignIn.errorUsePasskey",
    });

    expect(hashPasswordMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(createSessionUnlessBannedMock).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  test("refuses a banned account after the password verifies, and writes no session", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    findUserMock.mockResolvedValue({
      bannedAt: new Date("2026-01-01T00:00:00.000Z"),
      googleAccountId: null,
      id: "user-1",
      passwordHash: CURRENT_HASH,
    });

    await expect(signInWithPassword({
      email: "user@example.com",
      password: "current-password",
    })).rejects.toMatchObject({
      code: "FORBIDDEN",
      messageKey: "Client.Auth.SignIn.errorAccountSuspended",
    });

    expect(createSessionUnlessBannedMock).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  test("does not lock out a valid user when the opportunistic rehash fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    verifyPasswordMock.mockResolvedValue({
      isValid: true,
      needsRehash: true,
      scheme: "legacy-pbkdf2-sha256",
    });
    hashPasswordMock.mockRejectedValue(new Error("hashing unavailable"));

    await expect(signInWithPassword({
      email: "user@example.com",
      password: "legacy-password",
    })).resolves.toEqual({ success: true, preferredLocale: null });

    expect(consoleError).toHaveBeenCalledWith(
      "Failed to upgrade password hash after sign-in",
      expect.any(Error),
    );
    expect(createSessionUnlessBannedMock).toHaveBeenCalledWith({
      userId: "user-1",
      authenticationType: "password",
      recheck: expect.any(Function),
    });
    consoleError.mockRestore();
  });
  // The recheck runs after the session write. A reset or a Google reclaim that changed the hash
  // since the password verified makes it throw, and `createSessionUnlessBanned` rolls back.
  describe("the hash recheck after the session write", () => {
    async function signInAndGetRecheck(): Promise<(passwordHash: string | null) => void> {
      await signInWithPassword({ email: "user@example.com", password: "current-password" });

      const [{ recheck }] = createSessionUnlessBannedMock.mock.calls[0] as [{ recheck: Recheck }];

      return (passwordHash) => recheck({ bannedAt: null, passwordHash, passkeyLive: false });
    }

    test("passes when the hash is still the verified one", async () => {
      const recheck = await signInAndGetRecheck();

      expect(() => recheck(CURRENT_HASH)).not.toThrow();
    });

    test.each([
      { name: "a password reset", passwordHash: "pbkdf2-sha256$100000$salt$reset" },
      { name: "a Google reclaim", passwordHash: null },
      { name: "a deleted account", passwordHash: undefined },
    ])("refuses with the invalid-credentials error after $name", async ({ passwordHash }) => {
      await signInWithPassword({ email: "user@example.com", password: "current-password" });
      const [{ recheck }] = createSessionUnlessBannedMock.mock.calls[0] as [{ recheck: Recheck }];
      const state = passwordHash === undefined ? null : { bannedAt: null, passwordHash, passkeyLive: false };

      expect(() => recheck(state)).toThrow(expect.objectContaining({
        code: "NOT_AUTHORIZED",
        messageKey: "Client.Auth.SignIn.errorInvalidCredentials",
      }));
    });

    test("expects the upgraded hash after the rehash lands", async () => {
      verifyPasswordMock.mockResolvedValue({ isValid: true, needsRehash: true, scheme: "legacy-pbkdf2-sha256" });
      const recheck = await signInAndGetRecheck();

      expect(() => recheck("pbkdf2-sha256$100000$new-salt$new-hash")).not.toThrow();
    });

    // The compare-and-set lost to a reset, so the row holds a hash this sign-in never verified.
    test("expects the verified hash when the rehash loses to a reset", async () => {
      verifyPasswordMock
        .mockResolvedValueOnce({ isValid: true, needsRehash: true, scheme: "legacy-pbkdf2-sha256" })
        .mockResolvedValueOnce({ isValid: false, needsRehash: false, scheme: "pbkdf2-sha256" });
      returningMock.mockResolvedValue([]);
      findUserMock.mockResolvedValueOnce({ id: "user-1", passwordHash: CURRENT_HASH })
        .mockResolvedValueOnce({ passwordHash: RESET_HASH });
      const recheck = await signInAndGetRecheck();

      expect(verifyPasswordMock).toHaveBeenLastCalledWith({
        storedHash: RESET_HASH,
        passwordAttempt: "current-password",
      });
      expect(() => recheck(RESET_HASH)).toThrow(expect.objectContaining({ code: "NOT_AUTHORIZED" }));
      expect(() => recheck(CURRENT_HASH)).not.toThrow();
    });

    // A parallel sign-in upgraded the same password first, so its new hash verifies this password.
    test("expects the winner's hash when a parallel sign-in wins the rehash", async () => {
      verifyPasswordMock.mockResolvedValue({ isValid: true, needsRehash: true, scheme: "legacy-pbkdf2-sha256" });
      returningMock.mockResolvedValue([]);
      findUserMock.mockResolvedValueOnce({ id: "user-1", passwordHash: CURRENT_HASH })
        .mockResolvedValueOnce({ passwordHash: WINNER_HASH });
      const recheck = await signInAndGetRecheck();

      expect(() => recheck(WINNER_HASH)).not.toThrow();
      expect(() => recheck(CURRENT_HASH)).toThrow(expect.objectContaining({ code: "NOT_AUTHORIZED" }));
    });

    test("expects the verified hash when the rehash loses to a Google reclaim", async () => {
      verifyPasswordMock.mockResolvedValue({ isValid: true, needsRehash: true, scheme: "legacy-pbkdf2-sha256" });
      returningMock.mockResolvedValue([]);
      findUserMock.mockResolvedValueOnce({ id: "user-1", passwordHash: CURRENT_HASH })
        .mockResolvedValueOnce({ passwordHash: null });
      const recheck = await signInAndGetRecheck();

      expect(verifyPasswordMock).toHaveBeenCalledOnce();
      expect(() => recheck(null)).toThrow(expect.objectContaining({ code: "NOT_AUTHORIZED" }));
    });
  });
});

type Recheck = (state: SessionRecheckState | null) => void;
