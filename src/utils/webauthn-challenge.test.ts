import { beforeEach, describe, expect, test, vi } from "vitest";

const { getCloudflareContextMock } = vi.hoisted(() => ({
  getCloudflareContextMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/utils/cloudflare-context", () => ({
  getCloudflareContext: getCloudflareContextMock,
}));

const {
  consumeWebAuthnChallenge,
  storeWebAuthnChallenge,
  WEBAUTHN_CHALLENGE_PURPOSE,
} = await import("@/utils/webauthn-challenge");

describe("WebAuthn challenge storage", () => {
  const kv = {
    delete: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getCloudflareContextMock.mockResolvedValue({
      env: {
        KV_STORE: kv,
      },
    });
  });

  test("stores only the challenge digest and binds the intended user", async () => {
    await storeWebAuthnChallenge({
      challenge: "registration-challenge",
      purpose: WEBAUTHN_CHALLENGE_PURPOSE.SIGN_UP,
      userId: "usr_1",
    });

    const [storageKey, payload] = kv.put.mock.calls[0] ?? [];
    expect(storageKey).toMatch(/^webauthn-challenge:sign-up:[a-f0-9]{64}$/);
    expect(storageKey).not.toContain("registration-challenge");
    expect(JSON.parse(payload)).toMatchObject({
      purpose: "sign-up",
      userId: "usr_1",
    });
  });

  test("consumes a valid challenge only once", async () => {
    kv.get
      .mockResolvedValueOnce(JSON.stringify({
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        purpose: "authentication",
      }))
      .mockResolvedValueOnce(null);

    await expect(consumeWebAuthnChallenge({
      challenge: "authentication-challenge",
      purpose: WEBAUTHN_CHALLENGE_PURPOSE.AUTHENTICATION,
    })).resolves.toMatchObject({ purpose: "authentication" });

    await expect(consumeWebAuthnChallenge({
      challenge: "authentication-challenge",
      purpose: WEBAUTHN_CHALLENGE_PURPOSE.AUTHENTICATION,
    })).resolves.toBeNull();

    expect(kv.delete).toHaveBeenCalledOnce();
  });
});
