import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const {
  andMock,
  createAndStoreSessionMock,
  eqMock,
  findPasskeyMock,
  findUserMock,
  hashPasswordMock,
  hashTokenMock,
  resetRateLimitMock,
  setMock,
  updateMock,
  verifyPasswordMock,
  whereMock,
  withRateLimitMock,
} = vi.hoisted(() => {
  const where = vi.fn();
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const resetRateLimit = vi.fn();

  return {
    andMock: vi.fn((...conditions: unknown[]) => ({ conditions })),
    createAndStoreSessionMock: vi.fn(),
    eqMock: vi.fn((column: unknown, value: unknown) => ({ column, value })),
    findPasskeyMock: vi.fn(),
    findUserMock: vi.fn(),
    hashPasswordMock: vi.fn(),
    hashTokenMock: vi.fn(),
    resetRateLimitMock: resetRateLimit,
    setMock: set,
    updateMock: update,
    verifyPasswordMock: vi.fn(),
    whereMock: where,
    // Mirror the real withRateLimit: the counter refund only runs after the action succeeds.
    withRateLimitMock: vi.fn(
      async (action: () => Promise<unknown>, config: { resetOnSuccess?: boolean }) => {
        const result = await action();
        if (config?.resetOnSuccess) {
          await resetRateLimit();
        }
        return result;
      },
    ),
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
  createAndStoreSession: createAndStoreSessionMock,
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

describe("signInWithPassword", () => {
  beforeEach(() => {
    findUserMock.mockResolvedValue({
      googleAccountId: null,
      id: "user-1",
      passwordHash: CURRENT_HASH,
    });
    findPasskeyMock.mockResolvedValue(null);
    hashPasswordMock.mockResolvedValue("pbkdf2-sha256$100000$new-salt$new-hash");
    hashTokenMock.mockResolvedValue("email-digest");
    verifyPasswordMock.mockResolvedValue({
      isValid: true,
      needsRehash: false,
      scheme: "pbkdf2-sha256",
    });
    whereMock.mockResolvedValue({ meta: { changes: 1 } });
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

  test("clears the account rate-limit bucket after a successful sign-in", async () => {
    await signInWithPassword({
      email: "user@example.com",
      password: "current-password",
    });

    expect(createAndStoreSessionMock).toHaveBeenCalledWith("user-1", "password");
    expect(resetRateLimitMock).toHaveBeenCalledOnce();
  });

  test("does not clear the account rate-limit bucket when sign-in fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    verifyPasswordMock.mockResolvedValue({
      isValid: false,
      needsRehash: false,
      scheme: "pbkdf2-sha256",
    });

    await expect(signInWithPassword({
      email: "user@example.com",
      password: "wrong-password",
    })).rejects.toBeDefined();

    expect(resetRateLimitMock).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  test("does not rewrite a current password hash", async () => {
    await signInWithPassword({
      email: "user@example.com",
      password: "current-password",
    });

    expect(hashPasswordMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(createAndStoreSessionMock).toHaveBeenCalledWith("user-1", "password");
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
    expect(createAndStoreSessionMock).toHaveBeenCalledWith("user-1", "password");
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
    })).rejects.toBeDefined();

    expect(hashPasswordMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(createAndStoreSessionMock).not.toHaveBeenCalled();
    // Expected ActionError failures must not be logged as unexpected errors.
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
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
    })).rejects.toBeDefined();

    expect(hashPasswordMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(createAndStoreSessionMock).not.toHaveBeenCalled();
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
    })).resolves.toEqual({ success: true });

    expect(consoleError).toHaveBeenCalledWith(
      "Failed to upgrade password hash after sign-in",
      expect.any(Error),
    );
    expect(createAndStoreSessionMock).toHaveBeenCalledWith("user-1", "password");
    consoleError.mockRestore();
  });
});
