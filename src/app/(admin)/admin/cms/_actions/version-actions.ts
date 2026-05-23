"use server";

import { actionClient } from "@/lib/safe-action";
import { getCmsEntryVersions, getCmsEntryVersionCount, revertCmsEntryToVersion, deleteCmsEntryVersion } from "@/lib/cms/cms-repository";
import { requireAdmin } from "@/utils/auth";
import { v } from "@/lib/validation";

export const getCmsEntryVersionsAction = actionClient
  .inputSchema(v.object({
    entryId: v.string(),
  }))
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const versions = await getCmsEntryVersions(input.entryId);
    return versions;
  });

export const getCmsEntryVersionCountAction = actionClient
  .inputSchema(v.object({
    entryId: v.string(),
  }))
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const versionCount = await getCmsEntryVersionCount(input.entryId);
    return versionCount;
  });

export const revertCmsEntryVersionAction = actionClient
  .inputSchema(v.object({
    entryId: v.string(),
    versionId: v.string(),
  }))
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const updatedEntry = await revertCmsEntryToVersion({
      entryId: input.entryId,
      versionId: input.versionId,
    });
    return updatedEntry;
  });

export const deleteCmsEntryVersionAction = actionClient
  .inputSchema(v.object({
    entryId: v.string(),
    versionId: v.string(),
  }))
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    await deleteCmsEntryVersion({
      entryId: input.entryId,
      versionId: input.versionId,
    });
    return { success: true };
  });
