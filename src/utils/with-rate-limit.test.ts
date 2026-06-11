import { afterEach, describe, expect, test, vi } from "vitest";

const {
  checkRateLimitMock,
  getIPMock,
} = vi.hoisted(() => ({
  checkRateLimitMock: vi.fn(),
  getIPMock: vi.fn(),
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
}));

const { RATE_LIMITS, withRateLimit } = await import("@/utils/with-rate-limit");

describe("withRateLimit", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("marks get-session as a soft limiter with deferred counter writes", () => {
    expect(RATE_LIMITS.GET_SESSION_API.deferWrite).toBe(true);
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
});
