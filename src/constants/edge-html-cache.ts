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
