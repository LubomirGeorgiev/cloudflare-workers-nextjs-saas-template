import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("cloudflare:workers", () => ({
  waitUntil: vi.fn(),
}));

const updateWhere = vi.fn(() => Promise.resolve());
const updateSet = vi.fn(() => ({ where: updateWhere }));
const update = vi.fn(() => ({ set: updateSet }));

vi.mock("@/db", () => ({
  getDB: () => ({ update }),
}));

import { resetUserActivityThrottleForTests, touchUserLastActiveAt, USER_ACTIVITY_UPDATE_INTERVAL_MS } from "./user-activity";

describe("touchUserLastActiveAt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetUserActivityThrottleForTests();
    update.mockClear();
    updateSet.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("writes once, then throttles repeat touches within the interval", () => {
    touchUserLastActiveAt("usr_1");
    touchUserLastActiveAt("usr_1");
    vi.advanceTimersByTime(USER_ACTIVITY_UPDATE_INTERVAL_MS - 1);
    touchUserLastActiveAt("usr_1");

    expect(update).toHaveBeenCalledTimes(1);
    expect(updateSet).toHaveBeenCalledWith({ lastActiveAt: expect.any(Date) });
  });

  test("writes again once the interval has elapsed", () => {
    touchUserLastActiveAt("usr_1");
    vi.advanceTimersByTime(USER_ACTIVITY_UPDATE_INTERVAL_MS);
    touchUserLastActiveAt("usr_1");

    expect(update).toHaveBeenCalledTimes(2);
  });

  test("throttles per user, not globally", () => {
    touchUserLastActiveAt("usr_1");
    touchUserLastActiveAt("usr_2");

    expect(update).toHaveBeenCalledTimes(2);
  });
});
