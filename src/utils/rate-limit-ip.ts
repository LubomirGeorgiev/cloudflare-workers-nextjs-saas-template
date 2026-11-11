import * as ipaddr from "ipaddr.js";

// Pure, so a caller that builds a compound key (such as `scopeId:ip`) can apply the same rule
// before the scope hides the IP from `buildWindowKey`.

/**
 * The rate-limit form of one IP. An IPv6 address becomes its /64 subnet, because one host usually
 * holds a whole /64 and could otherwise get a new budget for each address. Any other value is kept.
 */
export function normalizeRateLimitIp(ip: string): string {
  if (!ipaddr.isValid(ip)) {
    return ip;
  }
  try {
    const addr = ipaddr.parse(ip);

    if (addr.kind() === "ipv6") {
      const bytes = (addr as ipaddr.IPv6).toByteArray();
      // Zero out the last 8 bytes (64 bits)
      for (let i = 8; i < 16; i++) {
        bytes[i] = 0;
      }
      return `${ipaddr.fromByteArray(bytes).toString()}/64`;
    }
    return addr.toString();
  } catch {
    return ip;
  }
}
