"use server";

import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { requireAdmin } from "@/utils/auth";
import { cmsConfig, zodCollectionEnum, type CollectionsUnion } from "@/../cms.config";
import { createCmsEntrySchema, updateCmsEntrySchema, cmsEntryStatusSchema } from "@/schemas/cms-entry.schema";
import {
  getCmsCollection,
  getCmsCollectionCount,
  createCmsEntry,
  updateCmsEntry,
  deleteCmsEntry,
  getCmsEntryById,
} from "@/lib/cms/cms-repository";
import { generateSeoDescription } from "@/lib/cms/generate-seo-description";
import { cmsStatusFilterTuple } from "@/types/cms";

const listStatusEnum = z.enum(cmsStatusFilterTuple);

export const listCmsEntriesAction = actionClient
  .inputSchema(
    z.object({
      collection: zodCollectionEnum,
      status: listStatusEnum.optional().default("all"),
      limit: z.number().optional().default(20),
      offset: z.number().optional().default(0),
    })
  )
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const [entries, totalCount] = await Promise.all([
      getCmsCollection({
        collectionSlug: input.collection,
        status: input.status,
        limit: input.limit,
        offset: input.offset,
        includeRelations: {
          createdByUser: true,
          tags: true,
        },
      }),
      getCmsCollectionCount({
        collectionSlug: input.collection,
        status: input.status,
      }),
    ]);

    return { entries, totalCount };
  });

export const createCmsEntryAction = actionClient
  .inputSchema(createCmsEntrySchema)
  .action(async ({ parsedInput: input }) => {
    const session = await requireAdmin();

    if (!session?.userId) {
      throw new ActionError("FORBIDDEN", "Not authorized");
    }

    const newEntry = await createCmsEntry({
      ...input,
      collectionSlug: input.collection as CollectionsUnion,
      createdBy: session.userId,
    });

    return newEntry;
  });

export const updateCmsEntryAction = actionClient
  .inputSchema(updateCmsEntrySchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const updatedEntry = await updateCmsEntry(input);

    if (!updatedEntry) {
      throw new ActionError("NOT_FOUND", "Entry not found");
    }

    return updatedEntry;
  });

export const deleteCmsEntryAction = actionClient
  .inputSchema(z.object({ id: z.string() }))
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    await deleteCmsEntry({ id: input.id });

    return { success: true };
  });

export const generateSeoDescriptionAction = actionClient
  .inputSchema(
    z.object({
      id: z.string().min(1, "Entry ID is required"),
    })
  )
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const entry = await getCmsEntryById({ id: input.id });

    if (!entry) {
      throw new ActionError("NOT_FOUND", "Entry not found");
    }

    const description = await generateSeoDescription({
      title: entry.title,
      content: entry.content,
      collectionSlug: entry.collection,
    });

    if (!description) {
      throw new ActionError("INTERNAL_SERVER_ERROR", "Failed to generate SEO description");
    }

    return { description };
  });
