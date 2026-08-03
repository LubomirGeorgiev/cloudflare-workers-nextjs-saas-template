// Server-side OAuth lifecycle tuning: token and registration lifetimes, the cron sweep budgets
// calibrated against them, and the grant snapshot cache. None of it is meaningful to a browser, so
// it lives here rather than in the flat `constants.ts` every client component imports. Endpoint
// paths and the DCR kill-switch stay there — those the UI and the docs pages genuinely read.

// Deliberately generous: some claude.ai connector proxy paths never exercise the refresh flow.
export const OAUTH_ACCESS_TOKEN_TTL_SECONDS = 2 * 60 * 60;
// Documented template knob. The window is fixed at code exchange — rotation does NOT slide it —
// so 90d means a one-click re-consent per quarter plus automatic cleanup of idle grants. Set to
// `undefined` for never-expiring refresh tokens (the "until revoked" model); revocation still
// works from /settings/api-mcp.
export const OAUTH_REFRESH_TOKEN_TTL_SECONDS: number | undefined = 90 * 24 * 60 * 60;
// Lifetime of the provider's KV `client:` record, passed explicitly to the library rather than
// inherited from its internal default: the whole renewal policy below is calibrated to this
// number, so a compatible dependency bump must not be able to move it silently.
export const OAUTH_CLIENT_REGISTRATION_TTL_SECONDS = 90 * 24 * 60 * 60;
// The library re-applies the registration TTL on every updateClient() call, which is exactly what
// makes the cron touch a renewal. The interval must stay far inside the TTL so that several
// consecutive failed sweeps still cannot let a live client's record expire — roughly 12 renewals
// per lifetime at these values, asserted in tests/integration/oauth-provider.test.ts.
export const OAUTH_CLIENT_RENEWAL_INTERVAL_SECONDS = 7 * 24 * 60 * 60;
export const OAUTH_CLIENT_RENEWAL_BATCH_SIZE = 5;
// How many verified apps one cron tick may touch. Each renewal is a KV read + write, so this stays
// far inside the per-invocation subrequest budget even on a busy deployment.
export const OAUTH_CLIENT_RENEWAL_PAGE_SIZE = 25;
// Mirror pruning only runs after the provider reports a complete orphan-grant sweep. This cap
// then bounds the extra client lookups and D1 delete candidates added to that cron invocation.
export const OAUTH_APP_PRUNE_PAGE_SIZE = 25;
// Approval touches a CIMD mirror before its grant is created. Retain it one day beyond the longest
// token lifetime; with non-expiring refresh grants no safe age cutoff exists, so pruning is off.
export const OAUTH_UNVERIFIED_CIMD_RETENTION_SECONDS =
  OAUTH_REFRESH_TOKEN_TTL_SECONDS === undefined
    ? undefined
    : Math.max(OAUTH_REFRESH_TOKEN_TTL_SECONDS, OAUTH_ACCESS_TOKEN_TTL_SECONDS) + 24 * 60 * 60;
// Same TTL/version discipline as the API-key snapshot: revocation deletes the grant, so the
// worst case is this TTL plus KV cross-PoP propagation.
export const OAUTH_GRANT_CACHE_TTL_SECONDS = 300;
export const CURRENT_OAUTH_GRANT_CACHE_VERSION = 1;
