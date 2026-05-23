"use server";

import { actionClient } from "@/lib/safe-action";
import { z } from "zod";
import { getCmsEntryVersions, getCmsEntryVersionCount, revertCmsEntryToVersion, deleteCmsEntryVersion } from "@/lib/cms/cms-repository";
import { requireAdmin } from "@/utils/auth";

export const getCmsEntryVersionsAction = actionClient
  .inputSchema(z.object({
    entryId: z.string(),
  }))
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const versions = await getCmsEntryVersions(input.entryId);
    return versions;
  });

export const getCmsEntryVersionCountAction = actionClient
  .inputSchema(z.object({
    entryId: z.string(),
  }))
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const versionCount = await getCmsEntryVersionCount(input.entryId);
    return versionCount;
  });

export const revertCmsEntryVersionAction = actionClient
  .inputSchema(z.object({
    entryId: z.string(),
    versionId: z.string(),
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
  .inputSchema(z.object({
    entryId: z.string(),
    versionId: z.string(),
  }))
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    await deleteCmsEntryVersion({
      entryId: input.entryId,
      versionId: input.versionId,
    });
    return { success: true };
  });
