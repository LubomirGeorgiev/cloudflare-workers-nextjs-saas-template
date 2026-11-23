import { afterEach, describe, expect, test, vi } from "vitest";

const {
  getCloudflareContextMock,
  waitUntilMock,
} = vi.hoisted(() => ({
  getCloudflareContextMock: vi.fn(),
  waitUntilMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("cloudflare:workers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("cloudflare:workers")>()),
  waitUntil: waitUntilMock,
}));

vi.mock("@/utils/cloudflare-context", () => ({
  getCloudflareContext: getCloudflareContextMock,
}));

const { checkRateLimit, resetRateLimit } = await import("@/utils/rate-limit");

describe("checkRateLimit", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("defers successful counter writes when configured", async () => {
    const { kv, resolvePut } = mockPendingKvWrite();

    const resultPromise = checkSessionRateLimit({ deferWrite: true });
    const resolution = await getPromiseResolutionState(resultPromise);

    expect(resolution).toBe("resolved");
    expect(kv.put).toHaveBeenCalledOnce();
    expect(waitUntilMock).toHaveBeenCalledOnce();
    await expectAllowedRateLimit(resultPromise);

    resolvePut();
    await waitUntilMock.mock.calls[0][0];
  });

  test("logs a rejected deferred write and does not fail the caller", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { rejectPut } = mockPendingKvWrite();

    const resultPromise = checkSessionRateLimit({ deferWrite: true });
    await expectAllowedRateLimit(resultPromise);

    rejectPut(new Error("KV PUT failed: 429 Too Many Requests"));
    await waitUntilMock.mock.calls[0][0];

    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    expect(JSON.parse(String(consoleErrorSpy.mock.calls[0][0]))).toMatchObject({
      provider: "kv",
      operation: "rate_limit.session",
      outcome: "rate_limited",
      statusCode: "429",
      errorName: "Error",
    });
    consoleErrorSpy.mockRestore();
  });

  test("awaits successful counter writes by default", async () => {
    const { resolvePut } = mockPendingKvWrite();

    const resultPromise = checkSessionRateLimit();
    const resolution = await getPromiseResolutionState(resultPromise);

    expect(resolution).toBe("pending");
    expect(waitUntilMock).not.toHaveBeenCalled();

    resolvePut();
    await expectAllowedRateLimit(resultPromise);
  });

  test("fails the caller when an awaited counter write fails for another reason", async () => {
    const { rejectPut } = mockPendingKvWrite();

    const resultPromise = checkSessionRateLimit();
    rejectPut(new Error("KV PUT failed: 500 Internal Server Error"));

    await expect(resultPromise).rejects.toThrow("KV PUT failed: 500");
    expect(waitUntilMock).not.toHaveBeenCalled();
  });

  test("refuses with a short reset when KV rate limits an awaited counter write", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { rejectPut } = mockPendingKvWrite();
    const nowSeconds = Math.floor(Date.now() / 1000);

    const resultPromise = checkSessionRateLimit();
    rejectPut(new Error("KV PUT failed: 429 Too Many Requests"));
    const result = await resultPromise;

    expect(result).toMatchObject({ success: false, remaining: 5, limit: 5, isStoreRateLimited: true });
    expect(result.reset - nowSeconds).toBeLessThanOrEqual(2);
    expect(JSON.parse(String(consoleErrorSpy.mock.calls[0][0]))).toMatchObject({
      provider: "kv",
      operation: "rate_limit.session",
      outcome: "rate_limited",
      statusCode: "429",
    });
    consoleErrorSpy.mockRestore();
  });
});

describe("resetRateLimit", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("deletes the current window's counter key", async () => {
    const deleteMock = vi.fn(async (__key: string) => undefined);
    getCloudflareContextMock.mockResolvedValue({
      env: {
        KV_STORE: {
          delete: deleteMock,
        },
      },
    });

    await resetRateLimit({
      key: "account:digest",
      identifier: "sign-in-account",
      windowInSeconds: 3_600,
    });

    expect(deleteMock).toHaveBeenCalledTimes(1);
    const deletedKey = deleteMock.mock.calls[0][0];
    expect(deletedKey).toMatch(/^rate-limit:sign-in-account:account:digest:\d+$/);
  });
});

function checkSessionRateLimit({ deferWrite }: { deferWrite?: boolean } = {}) {
  return checkRateLimit({
    key: "user-1",
    options: {
      identifier: "session",
      limit: 5,
      windowInSeconds: 60,
      ...(deferWrite === undefined ? {} : { deferWrite }),
    },
  });
}

async function getPromiseResolutionState(promise: Promise<unknown>) {
  return Promise.race([
    promise.then(() => "resolved" as const),
    new Promise<"pending">((resolve) => {
      setTimeout(() => resolve("pending"), 0);
    }),
  ]);
}

async function expectAllowedRateLimit(resultPromise: ReturnType<typeof checkRateLimit>) {
  await expect(resultPromise).resolves.toMatchObject({
    success: true,
    remaining: 4,
    limit: 5,
  });
}

function mockPendingKvWrite() {
  let resolvePut: () => void = () => undefined;
  let rejectPut: (error: Error) => void = () => undefined;
  const putPromise = new Promise<void>((resolve, reject) => {
    resolvePut = resolve;
    rejectPut = reject;
  });
  const kv = {
    get: vi.fn(async () => "0"),
    put: vi.fn(() => putPromise),
  };
  getCloudflareContextMock.mockResolvedValue({
    env: {
      KV_STORE: kv,
    },
  });

  return {
    kv,
    resolvePut,
    rejectPut,
  };
}
