import "server-only";

import { cache as workersCache, env as workerEnv } from "cloudflare:workers";

import type { CollectionsUnion } from "@/../cms.config";
import {
  EDGE_HTML_CACHE_TTL_MINUTES,
  EDGE_HTML_CACHE_ZONE_PURGED_TTL_MINUTES,
} from "@/constants/cache-control";
import { CMS_PURGE_STATUS, type CmsCachePurgeOutcome } from "@/constants/cache-purge";
import {
  EDGE_HTML_ZONE_PURGE_OUTCOME,
  type EdgeHtmlZonePurgeOutcome,
} from "@/constants/edge-html-cache";
import { MARKDOWN_PAGE_CACHE_PREFIX, VINEXT_CACHE_PREFIX } from "@/constants/kv-prefixes";
import { BLOG_LISTING_ROUTES, STATIC_PUBLIC_ROUTES } from "@/constants/public-routes";
import { ActionError } from "@/lib/action-error";
import {
  getCachePurgeConfig,
  isZonePurgeConfigured,
  purgeZoneCacheEverything,
} from "@/lib/cloudflare-api";
import { invalidateAllCmsCaches, runCmsCacheInvalidation } from "@/lib/cms/cms-cache-invalidation";
import { DOCS_EDGE_HTML_PATHNAMES } from "@/lib/cms/cms-navigation-page-purge";
import {
  getCmsSearchCacheTags,
  getSearchableCollections,
  isCollectionSearchEnabled,
  rebuildCmsSearchIndex,
} from "@/lib/cms/cms-search";
import { purgeEdgeHtmlPages } from "@/lib/edge/edge-html-cache";
import { isWorkersCachePurgeAvailable } from "@/lib/edge/workers-cache-purge";
import type { SystemAction } from "@/schemas/system-action.schema";

// One code path behind the admin panel, the internal REST API, and the internal MCP tools.
// No `revalidatePath` here: API and MCP handlers have no App Router request scope.
// Authorization is the caller's job (`requireAdmin` in the action, `adminOperation` in routes).

const PURGEABLE_KV_CACHE_PREFIXES = [VINEXT_CACHE_PREFIX, MARKDOWN_PAGE_CACHE_PREFIX] as const;

// The one sentence the panel, the REST refusal, and an agent all read when the zone purge cannot
// run. It names the credential to add, because that is the only thing that unblocks the operation.
const CLOUDFLARE_CDN_PURGE_MISSING_CONFIG_MESSAGE =
  "The Cloudflare CDN purge is not configured. Give the Worker a CLOUDFLARE_API_TOKEN with the " +
  "Cache Purge permission and a CLOUDFLARE_ACCOUNT_ID, or set CLOUDFLARE_ZONE_ID to name the zone " +
  "directly.";

// The sentences a CMS invalidation adds when one of its purges failed. A retry of the action can fix
// both; a missing zone config cannot, and the panel already warns about it.
const CMS_ZONE_PURGE_FAILED_NOTE =
  "The zone purge failed: other data centers keep their old pages until they expire, within " +
  `${EDGE_HTML_CACHE_ZONE_PURGED_TTL_MINUTES} minutes.`;
const CMS_WORKERS_CACHE_PURGE_FAILED_NOTE =
  "The Workers Caching purge failed: edge copies of the Markdown pages, the sitemap, and the " +
  "other machine responses stay until they expire.";
const CMS_PURGE_RETRY_NOTE = "Run the action again to retry.";

// As a subtree, the root names every stored page of this build.
const ROOT_PATHNAME = "/";

// The public pages every install serves, locale-free. `purgeEdgeHtmlPages` adds the locale prefix,
// so a pathname here must never carry one. The CMS pages come from the page collector below.
const ALWAYS_PUBLIC_EDGE_HTML_PATHNAMES: readonly string[] = [
  ...STATIC_PUBLIC_ROUTES.map(({ pathname }) => pathname),
  ...BLOG_LISTING_ROUTES.map(({ pathname }) => pathname),
  ...DOCS_EDGE_HTML_PATHNAMES,
];

// oxlint-disable-next-line project/no-unused-module-exports -- Part of the service contract every caller types against.
export interface AdminSystemActionResult {
  /** Untranslated, machine-facing prose: the same sentence the panel shows and an agent reads. */
  message: string;
  /** Part of the work failed and `message` names it, so the panel warns instead of reporting success. */
  partial?: boolean;
}

/** The two purges that count their work — one KV, one Cache API; the count is required for both. */
// oxlint-disable-next-line project/no-unused-module-exports -- Part of the service contract every caller types against.
export interface AdminPurgeCountResult extends AdminSystemActionResult {
  deletedKeyCount: number;
}

// oxlint-disable-next-line project/no-unused-module-exports -- Part of the service contract every caller types against.
export interface AdminEdgeHtmlPurgeResult extends AdminPurgeCountResult {
  zonePurge: EdgeHtmlZonePurgeOutcome;
}

function getVinextCache(): KVNamespace {
  const cache = workerEnv.KV_STORE;

  if (!cache) {
    throw new ActionError("INTERNAL_SERVER_ERROR", "Vinext cache KV binding is unavailable");
  }

  return cache;
}

/**
 * Every public page this install serves, locale-free. The sitemap reads the same collector, so the
 * purge covers exactly the pages a crawler is offered.
 *
 * The collector is imported lazily to keep the CMS repositories off this module's graph, and its
 * reads go through the data cache, which needs a request scope the REST and MCP callers do not
 * have. A failure there falls back to the static routes rather than failing the purge.
 */
async function listPublicPagePathnames(): Promise<string[]> {
  const pathnames = new Set<string>(ALWAYS_PUBLIC_EDGE_HTML_PATHNAMES);

  try {
    const { collectPublicPages } = await import("@/lib/sitemap/public-pages");

    for (const { pathname } of await collectPublicPages()) {
      // A fork's `previewUrl` may return an absolute or protocol-relative URL, which
      // `purgeEdgeHtmlPages` would take as a cache key of its own rather than a pathname to localize.
      if (pathname.startsWith("/") && !pathname.startsWith("//")) {
        pathnames.add(pathname);
      }
    }
  } catch (error) {
    // A partial purge is still correct; `EDGE_HTML_CACHE_TTL_SECONDS` bounds what it missed.
    console.error("listPublicPagePathnames: collecting public pages failed", error);
  }

  return Array.from(pathnames);
}

function formatEdgeHtmlPurgeMessage({
  deletedKeyCount,
  zonePurge,
}: {
  deletedKeyCount: number;
  zonePurge: EdgeHtmlZonePurgeOutcome;
}): string {
  const pageLabel = deletedKeyCount === 1 ? "page" : "pages";
  const deleted = `Deleted ${deletedKeyCount} stored ${pageLabel} from this data center's edge HTML cache`;

  switch (zonePurge) {
    case EDGE_HTML_ZONE_PURGE_OUTCOME.OK:
      return `${deleted}, and purged the stored pages in every other data center`;
    // Only a configured zone can fail, so the stored copies carry the zone-purged TTL.
    case EDGE_HTML_ZONE_PURGE_OUTCOME.FAILED:
      return `${deleted}, but the zone purge failed: other data centers keep their old copies ` +
        `until they expire, within ${EDGE_HTML_CACHE_ZONE_PURGED_TTL_MINUTES} minutes`;
    case EDGE_HTML_ZONE_PURGE_OUTCOME.UNCONFIGURED:
      return `${deleted}. The zone purge is not configured, so other data centers keep their ` +
        `copies until they expire, within ${EDGE_HTML_CACHE_TTL_MINUTES} minutes`;
    case EDGE_HTML_ZONE_PURGE_OUTCOME.NONE:
      return deleted;
  }
}

// A failed purge is a partial result, not an error: the KV tags already dropped.
function toCmsInvalidationResult({
  message,
  outcome,
}: {
  message: string;
  outcome: CmsCachePurgeOutcome;
}): AdminSystemActionResult {
  const failureNotes = [
    ...(outcome.zone === CMS_PURGE_STATUS.FAILED ? [CMS_ZONE_PURGE_FAILED_NOTE] : []),
    ...(outcome.workersCache === CMS_PURGE_STATUS.FAILED ? [CMS_WORKERS_CACHE_PURGE_FAILED_NOTE] : []),
  ];

  if (failureNotes.length === 0) {
    return { message };
  }

  return { message: [`${message}.`, ...failureNotes, CMS_PURGE_RETRY_NOTE].join(" "), partial: true };
}

function formatDeletedKeyMessage(deletedKeyCount: number): string {
  const keyLabel = deletedKeyCount === 1 ? "key" : "keys";
  return `Deleted ${deletedKeyCount} Vinext and Markdown cache ${keyLabel}`;
}

async function deleteKvKeysByPrefix({
  cache,
  prefix,
}: {
  cache: KVNamespace;
  prefix: string;
}): Promise<number> {
  let cursor: string | undefined;
  let deletedKeyCount = 0;

  do {
    const page = await cache.list({
      cursor,
      prefix,
    });

    await Promise.all(page.keys.map(({ name }) => cache.delete(name)));
    deletedKeyCount += page.keys.length;
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return deletedKeyCount;
}

export async function purgeKvPageCaches(): Promise<AdminPurgeCountResult> {
  const cache = getVinextCache();

  // The two prefixes are independent key spaces; only the page loop inside each walk is sequential.
  const deletedPerPrefix = await Promise.all(
    PURGEABLE_KV_CACHE_PREFIXES.map((prefix) => deleteKvKeysByPrefix({ cache, prefix })),
  );
  const deletedKeyCount = deletedPerPrefix.reduce((total, count) => total + count, 0);

  return {
    deletedKeyCount,
    message: formatDeletedKeyMessage(deletedKeyCount),
  };
}

/**
 * Deletes the stored anonymous HTML pages from `caches.default` in the data center that runs this
 * call. With a zone purge, the root prefix also clears every stored page in every data center, the
 * pages no list names included, so an operator can clear them after a var or secret change.
 * Without one, copies elsewhere expire on their own TTL. It touches no KV key and no Workers Caching.
 * A failed or unconfigured zone purge is a partial result, not an error: the local delete already ran.
 */
export async function purgeEdgeHtmlCache(): Promise<AdminEdgeHtmlPurgeResult> {
  const pathnames = await listPublicPagePathnames();
  const { deletedCount: deletedKeyCount, zonePurge } = await purgeEdgeHtmlPages({
    pathnames,
    subtreePathnames: [ROOT_PATHNAME],
  });

  return {
    deletedKeyCount,
    message: formatEdgeHtmlPurgeMessage({ deletedKeyCount, zonePurge }),
    // Unconfigured warns too: other data centers keep serving their old copies until the TTL.
    partial:
      zonePurge === EDGE_HTML_ZONE_PURGE_OUTCOME.FAILED ||
      zonePurge === EDGE_HTML_ZONE_PURGE_OUTCOME.UNCONFIGURED,
    zonePurge,
  };
}

export async function purgeWorkersCdnCache(): Promise<AdminSystemActionResult> {
  if (!isWorkersCachePurgeAvailable()) {
    throw new ActionError(
      "PRECONDITION_FAILED",
      "The Workers CDN purge is not available: the runtime offers no cache.purge here",
    );
  }

  const result = await workersCache.purge({ purgeEverything: true });

  if (!result.success) {
    const details = result.errors.map((error) => error.message).join("; ") || "Unknown purge error";
    throw new ActionError("INTERNAL_SERVER_ERROR", `Failed to purge Workers CDN cache: ${details}`);
  }

  return {
    message: "Purged Workers CDN cache",
  };
}

/** Whether an action the Worker cannot always perform is offered at all. */
// oxlint-disable-next-line project/no-unused-module-exports -- Part of the service contract every caller types against.
export interface AdminSystemActionAvailability {
  purgeCloudflareCdnCache: boolean;
}

/**
 * Read by the admin page so the panel hides an action it cannot run. The zone lookup behind it is
 * memoized per isolate, so a rendered page pays the Cloudflare round trip at most once.
 */
export async function getSystemActionAvailability(): Promise<AdminSystemActionAvailability> {
  return {
    purgeCloudflareCdnCache: await isZonePurgeConfigured(),
  };
}

/**
 * The runtime twin of the deploy workflow's purge step: `purge_everything` on the whole zone, so
 * every URL the Worker serves is dropped at every location. Workers Static Assets (`/_next/static/*`)
 * keep their own cache, which a zone purge does not reach.
 */
export async function purgeCloudflareCdnCache(): Promise<AdminSystemActionResult> {
  const config = await getCachePurgeConfig();

  if (!config) {
    throw new ActionError("PRECONDITION_FAILED", CLOUDFLARE_CDN_PURGE_MISSING_CONFIG_MESSAGE);
  }

  try {
    const { purgeId } = await purgeZoneCacheEverything(config);

    return {
      message: purgeId
        ? `Purged the whole Cloudflare zone cache (purge ${purgeId})`
        : "Purged the whole Cloudflare zone cache",
    };
  } catch (error) {
    // A `CloudflareApiError` message already joins the API's own `errors` entries.
    const details = error instanceof Error ? error.message : "Unknown purge error";

    throw new ActionError(
      "INTERNAL_SERVER_ERROR",
      `Failed to purge the Cloudflare CDN cache: ${details}`,
    );
  }
}

/**
 * Safe to repeat and safe to overlap: every rebuild chunk deletes its own entry ids in the same D1
 * batch that inserts them, so two concurrent rebuilds do the work twice but never duplicate a row.
 */
export async function rebuildSearchIndexes(
  collection: CollectionsUnion | undefined,
): Promise<AdminSystemActionResult> {
  const collections = collection ? [collection] : getSearchableCollections();

  if (collections.length === 0) {
    throw new ActionError("BAD_REQUEST", "No searchable collections are enabled");
  }

  if (collection && !isCollectionSearchEnabled(collection)) {
    throw new ActionError("BAD_REQUEST", "Search is not enabled for this collection");
  }

  await Promise.all(collections.map((entry) => rebuildCmsSearchIndex(entry)));
  const outcome = await runCmsCacheInvalidation({ tags: getCmsSearchCacheTags(collection) });

  return toCmsInvalidationResult({
    message: collection
      ? `Rebuilt search index for ${collection}`
      : "Rebuilt search indexes for all searchable collections",
    outcome,
  });
}

export async function clearSearchCache(
  collection: CollectionsUnion | undefined,
): Promise<AdminSystemActionResult> {
  if (collection && !isCollectionSearchEnabled(collection)) {
    throw new ActionError("BAD_REQUEST", "Search is not enabled for this collection");
  }

  const outcome = await runCmsCacheInvalidation({ tags: getCmsSearchCacheTags(collection) });

  return toCmsInvalidationResult({
    message: collection
      ? `Cleared search cache for ${collection}`
      : "Cleared search cache for all collections",
    outcome,
  });
}

export async function clearCmsCache(): Promise<AdminSystemActionResult> {
  return toCmsInvalidationResult({ message: "Cleared CMS cache", outcome: await invalidateAllCmsCaches() });
}

/** One maintenance action per call; the discriminator is the schema's `type`. */
export async function runAdminSystemAction(
  input: SystemAction,
): Promise<AdminSystemActionResult> {
  switch (input.type) {
    case "rebuild-search-index":
      return rebuildSearchIndexes(input.collection);

    case "clear-search-cache":
      return clearSearchCache(input.collection);

    case "clear-cms-cache":
      return clearCmsCache();

    case "purge-vinext-kv-cache":
      return purgeKvPageCaches();

    case "purge-workers-cdn-cache":
      return purgeWorkersCdnCache();

    case "purge-edge-html-cache":
      return purgeEdgeHtmlCache();

    case "purge-cloudflare-cdn-cache":
      return purgeCloudflareCdnCache();
  }
}
