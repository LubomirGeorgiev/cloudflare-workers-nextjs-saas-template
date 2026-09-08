import "server-only";

import { cache as workersCache, env as workerEnv } from "cloudflare:workers";

import type { CollectionsUnion } from "@/../cms.config";
import { MARKDOWN_PAGE_CACHE_PREFIX, VINEXT_CACHE_PREFIX } from "@/constants/kv-prefixes";
import { BLOG_LISTING_ROUTES, STATIC_PUBLIC_ROUTES } from "@/constants/public-routes";
import { ActionError } from "@/lib/action-error";
import { getCachePurgeConfig, purgeZoneCacheEverything } from "@/lib/cloudflare-api";
import { invalidateAllCmsCaches } from "@/lib/cms/cms-cache-invalidation";
import { DOCS_EDGE_HTML_PATHNAMES } from "@/lib/cms/cms-navigation-page-purge";
import {
  getSearchableCollections,
  invalidateCmsSearchCache,
  isCollectionSearchEnabled,
  rebuildCmsSearchIndex,
} from "@/lib/cms/cms-search";
import { purgeEdgeHtmlPages } from "@/lib/edge/edge-html-cache";
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
}

/** The two purges that count their work — one KV, one Cache API; the count is required for both. */
// oxlint-disable-next-line project/no-unused-module-exports -- Part of the service contract every caller types against.
export interface AdminPurgeCountResult extends AdminSystemActionResult {
  deletedKeyCount: number;
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
  } catch {
    // A partial purge is still correct; `EDGE_HTML_CACHE_TTL_SECONDS` bounds what it missed.
  }

  return Array.from(pathnames);
}

function formatDeletedPageMessage(deletedKeyCount: number): string {
  const pageLabel = deletedKeyCount === 1 ? "page" : "pages";

  return `Deleted ${deletedKeyCount} stored ${pageLabel} from this data center's edge HTML cache`;
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
 * call; with Smart Placement that is the one that holds them. Copies elsewhere expire on their own
 * TTL. It touches no KV key and no Workers Caching entry — those are separate operations.
 */
export async function purgeEdgeHtmlCache(): Promise<AdminPurgeCountResult> {
  const pathnames = await listPublicPagePathnames();
  const deletedKeyCount = await purgeEdgeHtmlPages({ pathnames });

  return {
    deletedKeyCount,
    message: formatDeletedPageMessage(deletedKeyCount),
  };
}

export async function purgeWorkersCdnCache(): Promise<AdminSystemActionResult> {
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
    purgeCloudflareCdnCache: (await getCachePurgeConfig()) !== null,
  };
}

/**
 * The runtime twin of the deploy workflow's purge step: `purge_everything` on the whole zone, so
 * every URL at every Cloudflare location is dropped — static assets, the stored HTML page copies,
 * and every machine response alike.
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
  await invalidateCmsSearchCache(collection);

  return {
    message: collection
      ? `Rebuilt search index for ${collection}`
      : "Rebuilt search indexes for all searchable collections",
  };
}

export async function clearSearchCache(
  collection: CollectionsUnion | undefined,
): Promise<AdminSystemActionResult> {
  if (collection && !isCollectionSearchEnabled(collection)) {
    throw new ActionError("BAD_REQUEST", "Search is not enabled for this collection");
  }

  await invalidateCmsSearchCache(collection);

  return {
    message: collection
      ? `Cleared search cache for ${collection}`
      : "Cleared search cache for all collections",
  };
}

export async function clearCmsCache(): Promise<AdminSystemActionResult> {
  await invalidateAllCmsCaches();

  return {
    message: "Cleared CMS cache",
  };
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
