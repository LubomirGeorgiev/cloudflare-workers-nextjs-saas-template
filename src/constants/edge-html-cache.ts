/**
 * Import-free on purpose: `scripts/measure-ttfb.mjs` is plain Node, which resolves neither a
 * tsconfig path alias nor an extensionless path, so it imports this module by relative path to
 * print the header the Worker stamps. Keep it a leaf.
 */

// Debug header on every HTML response. `scripts/measure-ttfb.mjs` prints it beside `cf-cache-status`.
export const EDGE_HTML_CACHE_HEADER = "x-edge-html-cache";
export const EDGE_HTML_CACHE_STATUS = {
  HIT: "hit",
  MISS: "miss",
  BYPASS: "bypass",
} as const;

// What the zone-wide half of an edge HTML purge did. Here, not in `src/lib/edge/edge-html-cache.ts`,
// because the admin API response schema names these values and must not import a server module.
export const EDGE_HTML_ZONE_PURGE_OUTCOME = {
  FAILED: "failed",
  // Nothing to send: no tag and no prefix.
  NONE: "none",
  OK: "ok",
  // No `CLOUDFLARE_API_TOKEN` or no zone, so only the named pages of the local data center went.
  UNCONFIGURED: "unconfigured",
} as const;

export type EdgeHtmlZonePurgeOutcome =
  typeof EDGE_HTML_ZONE_PURGE_OUTCOME[keyof typeof EDGE_HTML_ZONE_PURGE_OUTCOME];
