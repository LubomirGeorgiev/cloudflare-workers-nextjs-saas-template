/**
 * Every key space app code owns in NEXT_INC_CACHE_KV, in one place.
 *
 * `OAUTH_KV` is a second binding onto this same namespace (the OAuth provider hardcodes the name),
 * so the only thing keeping the two apart is prefix disjointness. Key builders import from here
 * rather than inlining a literal, which is what lets `kv-prefixes.test.ts` prove the property
 * instead of asserting against a hand-copied list that can silently fall behind.
 */
export const APP_KV_PREFIXES = {
  vinextCache: "vinext-cache",
  session: "session:",
  rateLimit: "rate-limit:",
  webauthnChallenge: "webauthn-challenge:",
  passwordReset: "password-reset:",
  emailVerification: "email-verification:",
  apiKey: "apikey:",
  apiKeyUser: "apikey-user:",
  oauthGrant: "oauthgrant:",
  oauthGrantUser: "oauthgrant-user:",
} as const;

/**
 * Owned by `@cloudflare/workers-oauth-provider` — never read or write these from app code.
 * `kv-prefixes.test.ts` scans the installed bundle and fails if an upgrade adds a key space, so the
 * per-upgrade re-audit is automated rather than remembered.
 */
export const OAUTH_RESERVED_KV_PREFIXES = [
  "client:",
  "grant:",
  "token:",
  "enterprise-jti:",
] as const;
