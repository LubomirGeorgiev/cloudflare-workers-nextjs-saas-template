import { beforeEach, describe, expect, test, vi } from "vitest";

const { getCloudflareContextMock } = vi.hoisted(() => ({
  getCloudflareContextMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/utils/cloudflare-context", () => ({
  getCloudflareContext: getCloudflareContextMock,
}));

const {
  createExpiringToken,
  deleteExpiringToken,
  getValidExpiringToken,
  hasValidExpiringToken,
} = await import("@/utils/kv-token");

describe("expiring bearer tokens", () => {
  const key = (tokenHash: string) => `test-token:${tokenHash}`;
  const kv = {
    delete: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getCloudflareContextMock.mockResolvedValue({
      env: {
        NEXT_INC_CACHE_KV: kv,
      },
    });
  });

  test("generates a 256-bit token and persists only its digest", async () => {
    const getRandomValues = vi.spyOn(globalThis.crypto, "getRandomValues");

    const token = await createExpiringToken({
      key,
      expiresInSeconds: 300,
      payload: { userId: "usr_1" },
    });

    expect(getRandomValues).toHaveBeenCalled();
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);

    const [storageKey] = kv.put.mock.calls[0] ?? [];
    expect(storageKey).toMatch(/^test-token:[a-f0-9]{64}$/);
    expect(storageKey).not.toContain(token);
  });

  test("looks up and deletes tokens by digest", async () => {
    const token = "raw-bearer-token";
    kv.get.mockResolvedValue(JSON.stringify({
      userId: "usr_1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }));

    await expect(getValidExpiringToken({
      token,
      key,
      notFoundError: { code: "NOT_FOUND", message: "not found" },
    })).resolves.toMatchObject({ userId: "usr_1" });

    await deleteExpiringToken({ token, key });

    expect(kv.get).toHaveBeenCalledWith(
      "test-token:bd835450997dfc19d3b9a9c19e971dd15d951285acef0f7dd452916e26c8a863",
    );
    expect(kv.delete).toHaveBeenCalledWith(
      "test-token:bd835450997dfc19d3b9a9c19e971dd15d951285acef0f7dd452916e26c8a863",
    );
  });

  test("rejects and cleans up expired tokens", async () => {
    kv.get.mockResolvedValue(JSON.stringify({
      userId: "usr_1",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    }));

    await expect(hasValidExpiringToken({
      token: "expired-token",
      key,
    })).resolves.toBe(false);

    expect(kv.delete).toHaveBeenCalledOnce();
  });
});
