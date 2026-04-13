"use server";

import { actionClient } from "@/lib/safe-action";
import { z } from "zod";
import { getCmsEntryVersions, revertCmsEntryToVersion, deleteCmsEntryVersion } from "@/lib/cms/cms-repository";
import { requireAdmin } from "@/utils/auth";

export const getCmsEntryVersionsAction = actionClient
  .inputSchema(z.object({
    entryId: z.string(),
  }))
  .action(async ({ parsedInput: input, ctx }) => {
    await requireAdmin(ctx);

    const versions = await getCmsEntryVersions(input.entryId);
    return versions;
  });

export const revertCmsEntryVersionAction = actionClient
  .inputSchema(z.object({
    entryId: z.string(),
    versionId: z.string(),
  }))
  .action(async ({ parsedInput: input, ctx }) => {
    await requireAdmin(ctx);

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
  .action(async ({ parsedInput: input, ctx }) => {
    await requireAdmin(ctx);

    await deleteCmsEntryVersion({
      entryId: input.entryId,
      versionId: input.versionId,
    });
    return { success: true };
  });
