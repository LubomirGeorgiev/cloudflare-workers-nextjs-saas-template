import { describe, expect, test } from "vitest";

import { APP_KV_PREFIXES, OAUTH_RESERVED_KV_PREFIXES } from "@/constants/kv-prefixes";

// `OAUTH_KV` is a second binding onto the namespace the rest of the app already uses, so the
// safety property is entirely about prefix disjointness. Both sides are asserted against the
// registries the key builders themselves consume — a prefix added to app code without a matching
// entry here cannot exist, because there is no second list to fall out of sync with.
describe("OAuth KV prefix reservation", () => {
  const appPrefixes = Object.values(APP_KV_PREFIXES);

  test("no app prefix overlaps a prefix reserved by the OAuth provider", () => {
    for (const appPrefix of appPrefixes) {
      for (const reserved of OAUTH_RESERVED_KV_PREFIXES) {
        expect(appPrefix.startsWith(reserved)).toBe(false);
        expect(reserved.startsWith(appPrefix)).toBe(false);
      }
    }
  });

  // Two app prefixes where one is a prefix of the other would make a `list()` sweep of the shorter
  // one silently enumerate the longer one's keys.
  test("no app prefix is a prefix of another app prefix", () => {
    for (const prefix of appPrefixes) {
      const others = appPrefixes.filter((candidate) => candidate !== prefix);

      expect(others.filter((other) => other.startsWith(prefix))).toEqual([]);
    }
  });

  test("the reserved list still covers every prefix the library writes", () => {
    // Re-audit on every library upgrade: these are the four key spaces v0.8.x touches
    // (`client:`, `grant:`, `token:` for OAuth records, `enterprise-jti:` for EMA replay markers).
    expect([...OAUTH_RESERVED_KV_PREFIXES].sort()).toEqual([
      "client:",
      "enterprise-jti:",
      "grant:",
      "token:",
    ]);
  });
});
