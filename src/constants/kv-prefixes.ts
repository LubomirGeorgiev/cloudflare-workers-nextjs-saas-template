/** Key space of the Vinext data cache adapter, configured in `vite.config.ts`. */
export const VINEXT_CACHE_PREFIX = "vinext-cache";

/** Key space of the rendered-page Markdown cache: `md-page:<build id>:<pathname>`. */
export const MARKDOWN_PAGE_CACHE_PREFIX = "md-page:";

/**
 * Every key space app code owns in NEXT_INC_CACHE_KV, in one place.
 *
 * `OAUTH_KV` is a second binding onto this same namespace (the OAuth provider hardcodes the name),
 * so the only thing keeping the two apart is prefix disjointness. Key builders import from here
 * rather than inlining a literal, which is what lets `kv-prefixes.test.ts` prove the property
 * instead of asserting against a hand-copied list that can silently fall behind.
 */
export const APP_KV_PREFIXES = {
  vinextCache: VINEXT_CACHE_PREFIX,
  markdownPage: MARKDOWN_PAGE_CACHE_PREFIX,
  session: "session:",
  rateLimit: "rate-limit:",
  webauthnChallenge: "webauthn-challenge:",
  passwordReset: "password-reset:",
  emailVerification: "email-verification:",
  apiKey: "apikey:",
  oauthGrant: "oauthgrant:",
  // Per-user invalidation stamp for `oauthgrant:` snapshots. API-key snapshots cannot use one:
  // their bearer path knows only the key hash, so it could not build this key without a second
  // round trip. A user's key hashes come from D1 instead.
  oauthGrantGeneration: "oauthgrant-gen:",
  // Last-run stamp per paced cron task, so a sweep's cadence is measured from its own last run
  // instead of inferred from the cron interval. See `src/lib/scheduler/paced-run.ts`.
  maintenanceRun: "maintenance-run:",
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
