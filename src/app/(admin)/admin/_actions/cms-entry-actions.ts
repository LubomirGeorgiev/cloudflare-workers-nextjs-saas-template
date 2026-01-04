"use server";

import { z } from "zod";
import { createServerAction, ZSAError } from "zsa";
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

const listStatusEnum = z.enum([...cmsEntryStatusSchema.options, "all"]);

export const listCmsEntriesAction = createServerAction()
  .input(
    z.object({
      collection: zodCollectionEnum,
      status: listStatusEnum.optional().default("all"),
      limit: z.number().optional().default(20),
      offset: z.number().optional().default(0),
    })
  )
  .handler(async ({ input }) => {
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

export const createCmsEntryAction = createServerAction()
  .input(createCmsEntrySchema)
  .handler(async ({ input }) => {
    const session = await requireAdmin();

    if (!session?.userId) {
      throw new ZSAError("FORBIDDEN", "Not authorized");
    }

    const newEntry = await createCmsEntry({
      ...input,
      collectionSlug: input.collection as CollectionsUnion,
      createdBy: session.userId,
    });

    return newEntry;
  });

export const updateCmsEntryAction = createServerAction()
  .input(updateCmsEntrySchema)
  .handler(async ({ input }) => {
    await requireAdmin();

    const updatedEntry = await updateCmsEntry(input);

    if (!updatedEntry) {
      throw new ZSAError("NOT_FOUND", "Entry not found");
    }

    return updatedEntry;
  });

export const deleteCmsEntryAction = createServerAction()
  .input(z.object({ id: z.string() }))
  .handler(async ({ input }) => {
    await requireAdmin();

    await deleteCmsEntry({ id: input.id });

    return { success: true };
  });

export const generateSeoDescriptionAction = createServerAction()
  .input(
    z.object({
      id: z.string().min(1, "Entry ID is required"),
    })
  )
  .handler(async ({ input }) => {
    await requireAdmin();

    const entry = await getCmsEntryById({ id: input.id });

    if (!entry) {
      throw new ZSAError("NOT_FOUND", "Entry not found");
    }

    const description = await generateSeoDescription({
      title: entry.title,
      content: entry.content,
      collectionSlug: entry.collection,
    });

    if (!description) {
      throw new ZSAError("INTERNAL_SERVER_ERROR", "Failed to generate SEO description");
    }

    return { description };
  });
