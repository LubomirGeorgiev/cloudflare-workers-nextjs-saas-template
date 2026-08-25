import type { OAuthAppRegistrationSource } from "@/db/schema";

// Pure classification of a client id, with no runtime dependency on the database module: a caller
// under test can reason about identity without mocking (and re-implementing) the whole store.

/** A Client ID Metadata Document identifies itself by URL, so the id is domain-bound. */
export function isCimdClientId(clientId: string): boolean {
  return clientId.startsWith("https://");
}

// Deterministic, and the reason the legacy correction below is safe: a URL-shaped id is never
// issued by dynamic registration, so it can only ever have been CIMD.
export function getDiscoveredOAuthAppRegistrationSource(
  clientId: string,
): Extract<OAuthAppRegistrationSource, "cimd" | "dcr"> {
  return isCimdClientId(clientId) ? "cimd" : "dcr";
}

// A loopback callback means the code is delivered to a program on the user's own device, not to a
// website. Consent says so, and DCR uses it to allow http on those hosts only.
export function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();

  if (normalized === "localhost" || normalized === "::1" || normalized === "[::1]") {
    return true;
  }

  return /^127(?:\.\d{1,3}){3}$/.test(normalized);
}
