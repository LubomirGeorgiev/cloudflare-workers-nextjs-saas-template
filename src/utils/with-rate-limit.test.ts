import { afterEach, describe, expect, test, vi } from "vitest";

const {
  checkRateLimitMock,
  getIPMock,
  resetRateLimitMock,
} = vi.hoisted(() => ({
  checkRateLimitMock: vi.fn(),
  getIPMock: vi.fn(),
  resetRateLimitMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("./is-prod", () => ({
  default: true,
}));

vi.mock("./is-test-mode", () => ({
  isTestMode: () => false,
}));

vi.mock("./get-IP", () => ({
  getIP: getIPMock,
}));

vi.mock("./rate-limit", () => ({
  checkRateLimit: checkRateLimitMock,
  resetRateLimit: resetRateLimitMock,
}));

const { RATE_LIMITS, withRateLimit } = await import("@/utils/with-rate-limit");

describe("withRateLimit", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("marks get-session as a soft limiter with deferred counter writes", () => {
    expect(RATE_LIMITS.GET_SESSION_API.deferWrite).toBe(true);
  });

  test("keeps separate IP and account sign-in limits", () => {
    expect(RATE_LIMITS.SIGN_IN).toEqual({
      identifier: "sign-in",
      limit: 15,
      windowInSeconds: 3_600,
    });
    expect(RATE_LIMITS.SIGN_IN_ACCOUNT).toEqual({
      identifier: "sign-in-account",
      limit: 10,
      windowInSeconds: 3_600,
    });
  });

  test("passes deferred write configuration to the rate limit checker", async () => {
    getIPMock.mockResolvedValue("203.0.113.10");
    checkRateLimitMock.mockResolvedValue({
      success: true,
      remaining: 49,
      reset: 1_765_000_000,
      limit: 50,
    });

    await expect(withRateLimit(async () => "ok", RATE_LIMITS.GET_SESSION_API)).resolves.toBe("ok");

    expect(checkRateLimitMock).toHaveBeenCalledWith({
      key: "203.0.113.10",
      options: {
        identifier: "get-session-api",
        limit: 50,
        windowInSeconds: 60,
        deferWrite: true,
      },
    });
  });

  test("uses an explicit account identifier without reading the client IP", async () => {
    checkRateLimitMock.mockResolvedValue({
      success: true,
      remaining: 9,
      reset: 1_765_000_000,
      limit: 10,
    });

    await expect(withRateLimit(
      async () => "ok",
      {
        ...RATE_LIMITS.SIGN_IN_ACCOUNT,
        userIdentifier: "account:digest",
      },
    )).resolves.toBe("ok");

    expect(getIPMock).not.toHaveBeenCalled();
    expect(checkRateLimitMock).toHaveBeenCalledWith({
      key: "account:digest",
      options: {
        identifier: "sign-in-account",
        limit: 10,
        windowInSeconds: 3_600,
      },
    });
  });

  test("normalizes an empty-string identifier and falls back to the client IP", async () => {
    getIPMock.mockResolvedValue("203.0.113.10");
    checkRateLimitMock.mockResolvedValue({
      success: true,
      remaining: 14,
      reset: 1_765_000_000,
      limit: 15,
    });

    await expect(withRateLimit(
      async () => "ok",
      {
        ...RATE_LIMITS.SIGN_IN,
        userIdentifier: "",
      },
    )).resolves.toBe("ok");

    expect(getIPMock).toHaveBeenCalledOnce();
    expect(checkRateLimitMock).toHaveBeenCalledWith({
      key: "203.0.113.10",
      options: {
        identifier: "sign-in",
        limit: 15,
        windowInSeconds: 3_600,
      },
    });
  });

  test("clears the bucket on success when resetOnSuccess is set", async () => {
    checkRateLimitMock.mockResolvedValue({
      success: true,
      remaining: 9,
      reset: 1_765_000_000,
      limit: 10,
    });

    await expect(withRateLimit(
      async () => "ok",
      {
        ...RATE_LIMITS.SIGN_IN_ACCOUNT,
        userIdentifier: "account:digest",
        resetOnSuccess: true,
      },
    )).resolves.toBe("ok");

    expect(resetRateLimitMock).toHaveBeenCalledWith({
      key: "account:digest",
      identifier: "sign-in-account",
      windowInSeconds: 3_600,
    });
  });

  test("does not clear the bucket when the wrapped action fails", async () => {
    checkRateLimitMock.mockResolvedValue({
      success: true,
      remaining: 9,
      reset: 1_765_000_000,
      limit: 10,
    });

    await expect(withRateLimit(
      async () => {
        throw new Error("auth failed");
      },
      {
        ...RATE_LIMITS.SIGN_IN_ACCOUNT,
        userIdentifier: "account:digest",
        resetOnSuccess: true,
      },
    )).rejects.toThrow("auth failed");

    expect(resetRateLimitMock).not.toHaveBeenCalled();
  });

  test("keeps the request alive when the success reset throws", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    checkRateLimitMock.mockResolvedValue({
      success: true,
      remaining: 9,
      reset: 1_765_000_000,
      limit: 10,
    });
    resetRateLimitMock.mockRejectedValue(new Error("KV unavailable"));

    await expect(withRateLimit(
      async () => "ok",
      {
        ...RATE_LIMITS.SIGN_IN_ACCOUNT,
        userIdentifier: "account:digest",
        resetOnSuccess: true,
      },
    )).resolves.toBe("ok");

    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
