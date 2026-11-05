import { beforeEach, describe, expect, test, vi } from "vitest";

const { getCloudflareContextMock } = vi.hoisted(() => ({
  getCloudflareContextMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/utils/cloudflare-context", () => ({
  getCloudflareContext: getCloudflareContextMock,
}));

const {
  createPasswordResetToken,
  getValidPasswordResetToken,
  hasValidPasswordResetToken,
  revokePasswordResetTokensOfUser,
} = await import("@/utils/password-reset-token");
const { PASSWORD_RESET_TOKEN_EXPIRATION_SECONDS } = await import("@/constants");
const { APP_KV_PREFIXES } = await import("@/constants/kv-prefixes");
const { getResetTokenKey } = await import("@/utils/auth-utils");
const { hashToken } = await import("@/utils/random-token");

const USER_ID = "usr_1";

describe("password reset tokens", () => {
  const store = new Map<string, string>();
  const kv = {
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string, __options: { expirationTtl: number }) => {
      store.set(key, value);
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    store.clear();
    getCloudflareContextMock.mockResolvedValue({ env: { KV_STORE: kv } });
  });

  test("a new link is valid, and a revoke kills it", async () => {
    const token = await createPasswordResetToken(USER_ID);

    await expect(getValidPasswordResetToken(token)).resolves.toMatchObject({ userId: USER_ID });
    await expect(hasValidPasswordResetToken(token)).resolves.toBe(true);

    await revokePasswordResetTokensOfUser(USER_ID);

    await expect(hasValidPasswordResetToken(token)).resolves.toBe(false);
    await expect(getValidPasswordResetToken(token)).rejects.toMatchObject({
      code: "NOT_FOUND",
      messageKey: "Client.Auth.ResetPassword.errorInvalidToken",
    });
  });

  test("a link issued after a revoke stays valid", async () => {
    await revokePasswordResetTokensOfUser(USER_ID);
    const token = await createPasswordResetToken(USER_ID);

    await expect(hasValidPasswordResetToken(token)).resolves.toBe(true);
  });

  test("a revoke of one user leaves the links of another user valid", async () => {
    const token = await createPasswordResetToken(USER_ID);

    await revokePasswordResetTokensOfUser("usr_2");

    await expect(hasValidPasswordResetToken(token)).resolves.toBe(true);
  });

  test("a link from before the stamp works until the first revoke", async () => {
    const token = "legacy-link";
    store.set(getResetTokenKey(await hashToken(token)), JSON.stringify({
      userId: USER_ID,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }));

    await expect(hasValidPasswordResetToken(token)).resolves.toBe(true);

    await revokePasswordResetTokensOfUser(USER_ID);

    await expect(hasValidPasswordResetToken(token)).resolves.toBe(false);
  });

  test("an expired link keeps its own error", async () => {
    const token = "expired-link";
    store.set(getResetTokenKey(await hashToken(token)), JSON.stringify({
      userId: USER_ID,
      generation: null,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    }));

    await expect(getValidPasswordResetToken(token)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      messageKey: "Client.Auth.ResetPassword.errorTokenExpired",
    });
  });

  test("the link and the stamp both carry a TTL, and the stamp outlives the link", async () => {
    const token = await createPasswordResetToken(USER_ID);
    await revokePasswordResetTokensOfUser(USER_ID);

    const ttlByKey = new Map(kv.put.mock.calls.map(([key, , options]) => [key, options.expirationTtl]));
    const linkTtl = ttlByKey.get(getResetTokenKey(await hashToken(token)));
    const stampTtl = ttlByKey.get(`${APP_KV_PREFIXES.passwordResetGeneration}${USER_ID}`);

    expect(linkTtl).toBe(PASSWORD_RESET_TOKEN_EXPIRATION_SECONDS);
    expect(stampTtl).toBeGreaterThan(PASSWORD_RESET_TOKEN_EXPIRATION_SECONDS);
  });
});
