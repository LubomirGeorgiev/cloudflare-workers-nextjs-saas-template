import { shouldLocalizePathname } from "@/i18n/localized-paths";

// A client-side navigation asks the same URL for a flight payload rather than a document, and a
// stored page must never answer one. The full gate below checks the rest of the router headers.
const PREFILTER_ROUTER_HEADER = "rsc";

/**
 * Cheap prefilter, deliberately broader than the real gate: `worker-entrypoint.ts` runs it on every
 * request to decide whether to import the cache module at all, so it reads no route table.
 *
 * `resolveEdgeHtmlCacheEntry` calls it first, which is what keeps it a superset by construction: a
 * request this refuses can never resolve to an entry, so widening the gate can never be silent.
 */
export function mayBeStoredHtmlPage({
  headers,
  method,
  url,
}: {
  headers: Headers;
  method: string;
  url: URL;
}): boolean {
  return (
    (method === "GET" || method === "HEAD") &&
    url.search === "" &&
    !headers.has(PREFILTER_ROUTER_HEADER) &&
    shouldLocalizePathname(url.pathname)
  );
}
