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
// Before you set `undefined`, know the KV cost: the provider then stores each grant with no expiry,
// and its purge only collects grants that have one, so every grant key lives forever.
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
// How many verified apps one cron tick may touch: 100 x 24 hourly ticks x 7 days = 16,800 renewals
// per renewal interval. The one real ceiling is the subrequest budget — a KV read + write each, so
// 200 of the 1,000 an invocation gets, shared with the purge and the prune. D1 id lists chunk.
export const OAUTH_CLIENT_RENEWAL_PAGE_SIZE = 100;
// How long the OAuth sweeps wait between runs. KV holds each sweep's last run and the scheduler
// measures the gap from it, so this value is free of the cron cadence: it needs no relation to the
// `crons` entry in wrangler.jsonc, and changing either one alone cannot re-pace the other.
export const OAUTH_MAINTENANCE_INTERVAL_MINUTES = 60;
// Mirror pruning checks every candidate against the provider, so this cap bounds the extra client
// lookups and D1 delete candidates one cron invocation adds on top of the purge and the renewals.
export const OAUTH_APP_PRUNE_PAGE_SIZE = 25;
// Passed explicitly to purgeExpiredData() rather than left to the library default, so a dependency
// bump cannot re-pace our cron. Every checked grant or token costs a KV read, and a dead grant adds
// a revokeGrant() fan-out, so the value stays small to protect the per-invocation subrequest budget.
export const OAUTH_PURGE_BATCH_SIZE = 50;
// Approval touches a CIMD mirror before its grant is created. Retain it one day beyond the longest
// token lifetime; with non-expiring refresh grants no safe age cutoff exists, so pruning is off.
export const OAUTH_UNVERIFIED_CIMD_RETENTION_SECONDS =
  OAUTH_REFRESH_TOKEN_TTL_SECONDS === undefined
    ? undefined
    : Math.max(OAUTH_REFRESH_TOKEN_TTL_SECONDS, OAUTH_ACCESS_TOKEN_TTL_SECONDS) + 24 * 60 * 60;
// Same TTL/version discipline as the API-key snapshot: revocation deletes the grant, so the
// worst case is this TTL plus KV cross-PoP propagation.
export const OAUTH_GRANT_CACHE_TTL_SECONDS = 300;
// The stamp that invalidates a user's grant snapshots must outlive every snapshot written before
// it, so a read finding no stamp can accept the snapshot it has. That is the cache TTL plus the
// ~60s KV needs to propagate a write to every PoP.
export const OAUTH_GRANT_GENERATION_TTL_SECONDS = OAUTH_GRANT_CACHE_TTL_SECONDS + 60;
// v2: the snapshot carries `bannedAt`, and a v1 entry cannot report a ban it never stored.
export const CURRENT_OAUTH_GRANT_CACHE_VERSION = 2;
