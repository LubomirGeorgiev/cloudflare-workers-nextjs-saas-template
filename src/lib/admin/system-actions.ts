import "server-only";

import { cache as workersCache, env as workerEnv } from "cloudflare:workers";

import type { CollectionsUnion } from "@/../cms.config";
import { MARKDOWN_PAGE_CACHE_PREFIX, VINEXT_CACHE_PREFIX } from "@/constants/kv-prefixes";
import { ActionError } from "@/lib/action-error";
import { invalidateAllCmsCaches } from "@/lib/cms/cms-cache-invalidation";
import {
  getSearchableCollections,
  invalidateCmsSearchCache,
  isCollectionSearchEnabled,
  rebuildCmsSearchIndex,
} from "@/lib/cms/cms-search";
import type { SystemAction } from "@/schemas/system-action.schema";

// One code path behind the admin panel, the internal REST API, and the internal MCP tools.
// No `revalidatePath` here: API and MCP handlers have no App Router request scope.
// Authorization is the caller's job (`requireAdmin` in the action, `adminOperation` in routes).

const PURGEABLE_KV_CACHE_PREFIXES = [VINEXT_CACHE_PREFIX, MARKDOWN_PAGE_CACHE_PREFIX] as const;

// oxlint-disable-next-line project/no-unused-module-exports -- Part of the service contract every caller types against.
export interface AdminSystemActionResult {
  /** Untranslated, machine-facing prose: the same sentence the panel shows and an agent reads. */
  message: string;
}

/** The KV purge is the one action that counts its work, so the count is required, never optional. */
// oxlint-disable-next-line project/no-unused-module-exports -- Part of the service contract every caller types against.
export interface AdminKvPurgeResult extends AdminSystemActionResult {
  deletedKeyCount: number;
}

function getVinextCache(): KVNamespace {
  const cache = workerEnv.KV_STORE;

  if (!cache) {
    throw new ActionError("INTERNAL_SERVER_ERROR", "Vinext cache KV binding is unavailable");
  }

  return cache;
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

export async function purgeKvPageCaches(): Promise<AdminKvPurgeResult> {
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
  }
}
