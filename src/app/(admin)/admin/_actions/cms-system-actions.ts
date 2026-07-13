"use server";

import { cache as workersCache, env as workerEnv } from "cloudflare:workers";
import { revalidatePath } from "next/cache";

import { cmsConfig, type CollectionsUnion } from "@/../cms.config";
import { VINEXT_CACHE_PREFIX } from "@/constants/vinext-cache";
import { ActionError } from "@/lib/action-error";
import { invalidateAllCmsCaches } from "@/lib/cms/cms-cache-invalidation";
import {
  invalidateCmsSearchCache,
  isCollectionSearchEnabled,
  rebuildCmsSearchIndex,
} from "@/lib/cms/cms-search";
import { actionClient } from "@/lib/safe-action";
import { cmsSystemActionSchema } from "@/schemas/cms-system.schema";
import { requireAdmin } from "@/utils/auth";

function getSearchableCollections(): CollectionsUnion[] {
  return Object.entries(cmsConfig.collections)
    .filter(([, collection]) => "enableSearch" in collection && collection.enableSearch)
    .map(([slug]) => slug as CollectionsUnion);
}

function getVinextCache(): KVNamespace {
  const cache = workerEnv.NEXT_INC_CACHE_KV;

  if (!cache) {
    throw new ActionError("INTERNAL_SERVER_ERROR", "Vinext cache KV binding is unavailable");
  }

  return cache;
}

function formatDeletedKeyMessage(deletedKeyCount: number): string {
  const keyLabel = deletedKeyCount === 1 ? "key" : "keys";
  return `Deleted ${deletedKeyCount} Vinext cache ${keyLabel}`;
}

async function purgeVinextKvCache(): Promise<{ deletedKeyCount: number; message: string }> {
  const cache = getVinextCache();

  let cursor: string | undefined;
  let deletedKeyCount = 0;

  do {
    const page = await cache.list({
      cursor,
      prefix: VINEXT_CACHE_PREFIX,
    });

    await Promise.all(page.keys.map(({ name }) => cache.delete(name)));
    deletedKeyCount += page.keys.length;
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return {
    deletedKeyCount,
    message: formatDeletedKeyMessage(deletedKeyCount),
  };
}

async function purgeWorkersCdnCache(): Promise<{ message: string }> {
  const result = await workersCache.purge({ purgeEverything: true });

  if (!result.success) {
    const details = result.errors.map((error) => error.message).join("; ") || "Unknown purge error";
    throw new ActionError("INTERNAL_SERVER_ERROR", `Failed to purge Workers CDN cache: ${details}`);
  }

  return {
    message: "Purged Workers CDN cache",
  };
}

export const runCmsSystemAction = actionClient
  .inputSchema(cmsSystemActionSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    switch (input.type) {
      case "rebuild-search-index": {
        const collections = input.collection ? [input.collection] : getSearchableCollections();

        if (collections.length === 0) {
          throw new ActionError("BAD_REQUEST", "No searchable collections are enabled");
        }

        const disabledCollection = input.collection && !isCollectionSearchEnabled(input.collection);

        if (disabledCollection) {
          throw new ActionError("BAD_REQUEST", "Search is not enabled for this collection");
        }

        await Promise.all(collections.map((collection) => rebuildCmsSearchIndex(collection)));
        await invalidateCmsSearchCache(input.collection);

        revalidatePath("/admin/cms");

        return {
          success: true,
          message: input.collection
            ? `Rebuilt search index for ${input.collection}`
            : "Rebuilt search indexes for all searchable collections",
        };
      }

      case "clear-search-cache": {
        if (input.collection && !isCollectionSearchEnabled(input.collection)) {
          throw new ActionError("BAD_REQUEST", "Search is not enabled for this collection");
        }

        await invalidateCmsSearchCache(input.collection);
        revalidatePath("/admin/cms");

        return {
          success: true,
          message: input.collection
            ? `Cleared search cache for ${input.collection}`
            : "Cleared search cache for all collections",
        };
      }

      case "clear-cms-cache": {
        await invalidateAllCmsCaches();
        revalidatePath("/admin/cms");

        return {
          success: true,
          message: "Cleared CMS cache",
        };
      }

      case "purge-vinext-kv-cache": {
        const result = await purgeVinextKvCache();
        return {
          success: true,
          message: result.message,
        };
      }

      case "purge-workers-cdn-cache": {
        const result = await purgeWorkersCdnCache();
        return {
          success: true,
          message: result.message,
        };
      }

      default:
        throw new ActionError("BAD_REQUEST", "Unsupported CMS system action");
    }
  });
