"use server";

import { createServerAction } from "zsa";
import { z } from "zod";
import { getCmsEntryVersions, revertCmsEntryToVersion, deleteCmsEntryVersion } from "@/lib/cms/cms-repository";
import { requireAdmin } from "@/utils/auth";

export const getCmsEntryVersionsAction = createServerAction()
  .input(z.object({
    entryId: z.string(),
  }))
  .handler(async ({ input, ctx }) => {
    await requireAdmin(ctx);

    const versions = await getCmsEntryVersions(input.entryId);
    return versions;
  });

export const revertCmsEntryVersionAction = createServerAction()
  .input(z.object({
    entryId: z.string(),
    versionId: z.string(),
  }))
  .handler(async ({ input, ctx }) => {
    await requireAdmin(ctx);

    const updatedEntry = await revertCmsEntryToVersion(input.entryId, input.versionId);
    return updatedEntry;
  });

export const deleteCmsEntryVersionAction = createServerAction()
  .input(z.object({
    entryId: z.string(),
    versionId: z.string(),
  }))
  .handler(async ({ input, ctx }) => {
    await requireAdmin(ctx);

    await deleteCmsEntryVersion(input.entryId, input.versionId);
    return { success: true };
  });
