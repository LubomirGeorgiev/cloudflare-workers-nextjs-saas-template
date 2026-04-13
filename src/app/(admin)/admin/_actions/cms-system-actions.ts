"use server";

import { revalidatePath } from "next/cache";
import { cmsConfig, type CollectionsUnion } from "@/../cms.config";
import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import {
  invalidateCmsSearchCache,
  isCollectionSearchEnabled,
  rebuildCmsSearchIndex,
} from "@/lib/cms/cms-search";
import { invalidateAllCmsCaches } from "@/lib/cms/cms-repository";
import { cmsSystemActionSchema } from "@/schemas/cms-system.schema";
import { requireAdmin } from "@/utils/auth";

function getSearchableCollections(): CollectionsUnion[] {
  return Object.entries(cmsConfig.collections)
    .filter(([, collection]) => "enableSearch" in collection && collection.enableSearch)
    .map(([slug]) => slug as CollectionsUnion);
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
          message:
            input.collection
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
          message:
            input.collection
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

      default:
        throw new ActionError("BAD_REQUEST", "Unsupported CMS system action");
    }
  });
