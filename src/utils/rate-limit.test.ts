import { afterEach, describe, expect, test, vi } from "vitest";

const {
  getCloudflareContextMock,
  waitUntilMock,
} = vi.hoisted(() => ({
  getCloudflareContextMock: vi.fn(),
  waitUntilMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("cloudflare:workers", () => ({
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
    const { putPromise, resolvePut } = mockPendingKvWrite();

    const resultPromise = checkSessionRateLimit({ deferWrite: true });
    const resolution = await getPromiseResolutionState(resultPromise);

    expect(resolution).toBe("resolved");
    expect(waitUntilMock).toHaveBeenCalledWith(putPromise);
    await expectAllowedRateLimit(resultPromise);

    resolvePut();
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
    const deletedKey = deleteMock.mock.calls[0][0] as string;
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
  const putPromise = new Promise<void>((resolve) => {
    resolvePut = resolve;
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
    putPromise,
    resolvePut,
  };
}
