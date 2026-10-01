"use server";

import { actionClient } from "@/lib/safe-action";
import {
  getCmsEntryById,
  getCmsEntryVersions,
  getCmsEntryVersionCount,
  revertCmsEntryToVersion,
  deleteCmsEntryVersion,
} from "@/lib/cms/entry";
import { revalidateCmsEntryPaths } from "@/app/[locale]/(app)/(admin)/admin/_actions/cms-entry-revalidation";
import { requireAdmin } from "@/utils/auth";
import { cmsEntryVersionListSchema, cmsEntryVersionRefSchema } from "@/schemas/cms-version.schema";

export const getCmsEntryVersionsAction = actionClient
  .metadata({ actionName: "getCmsEntryVersionsAction" })
  .inputSchema(cmsEntryVersionListSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const versions = await getCmsEntryVersions(input.entryId);
    return versions;
  });

export const getCmsEntryVersionCountAction = actionClient
  .metadata({ actionName: "getCmsEntryVersionCountAction" })
  .inputSchema(cmsEntryVersionListSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const versionCount = await getCmsEntryVersionCount(input.entryId);
    return versionCount;
  });

export const revertCmsEntryVersionAction = actionClient
  .metadata({ actionName: "revertCmsEntryVersionAction" })
  .inputSchema(cmsEntryVersionRefSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const previousEntry = await getCmsEntryById({ id: input.entryId });
    const updatedEntry = await revertCmsEntryToVersion({
      entryId: input.entryId,
      versionId: input.versionId,
    });

    revalidateCmsEntryPaths({
      collection: updatedEntry.collection,
      entryId: updatedEntry.id,
      slugs: [updatedEntry.slug],
      previousSlug: previousEntry?.slug,
    });

    return updatedEntry;
  });

export const deleteCmsEntryVersionAction = actionClient
  .metadata({ actionName: "deleteCmsEntryVersionAction" })
  .inputSchema(cmsEntryVersionRefSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    await deleteCmsEntryVersion({
      entryId: input.entryId,
      versionId: input.versionId,
    });
    return { success: true };
  });
