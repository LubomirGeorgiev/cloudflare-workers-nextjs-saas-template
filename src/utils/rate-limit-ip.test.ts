import { describe, expect, test } from "vitest";

import { normalizeRateLimitIp } from "@/utils/rate-limit-ip";

describe("normalizeRateLimitIp", () => {
  test("gives every address in one IPv6 /64 the same key", () => {
    const first = normalizeRateLimitIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
    const second = normalizeRateLimitIp("2001:db8:1:2::1");

    expect(first).toBe("2001:db8:1:2::/64");
    expect(second).toBe(first);
    expect(normalizeRateLimitIp("2001:db8:1:3::1")).not.toBe(first);
  });

  test("keeps an IPv4 address and a value that is not an IP", () => {
    expect(normalizeRateLimitIp("203.0.113.7")).toBe("203.0.113.7");
    expect(normalizeRateLimitIp("agent_1:203.0.113.7")).toBe("agent_1:203.0.113.7");
  });
});
