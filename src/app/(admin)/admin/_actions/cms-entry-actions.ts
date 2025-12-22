"use server";

import { z } from "zod";
import { createServerAction, ZSAError } from "zsa";
import { requireAdmin } from "@/utils/auth";
import { cmsConfig, zodCollectionEnum } from "@/../cms.config";
import { createCmsEntrySchema, updateCmsEntrySchema, cmsEntryStatusEnum } from "@/schemas/cms-entry.schema";
import {
  getCmsCollection,
  getCmsCollectionCount,
  createCmsEntry,
  updateCmsEntry,
  deleteCmsEntry,
  getCmsEntryById,
} from "@/lib/cms/cms-repository";
import { generateSeoDescription } from "@/lib/cms/generate-seo-description";
import { renderCmsContent } from "@/lib/render-cms-content";

const listStatusEnum = z.enum([...cmsEntryStatusEnum.options, "all"]);

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
      collectionSlug: input.collection as keyof typeof cmsConfig.collections,
      title: input.title,
      slug: input.slug,
      content: input.content,
      fields: input.fields,
      seoDescription: input.seoDescription,
      status: input.status,
      createdBy: session.userId,
      tagIds: input.tagIds,
    });

    return newEntry;
  });

export const updateCmsEntryAction = createServerAction()
  .input(updateCmsEntrySchema)
  .handler(async ({ input }) => {
    await requireAdmin();

    const updatedEntry = await updateCmsEntry({
      id: input.id,
      title: input.title,
      slug: input.slug,
      content: input.content,
      fields: input.fields,
      seoDescription: input.seoDescription,
      status: input.status,
      tagIds: input.tagIds,
    });

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

    const htmlContent = renderCmsContent(entry.content);
    const description = await generateSeoDescription({
      title: entry.title,
      htmlContent,
      collectionSlug: entry.collection,
    });

    if (!description) {
      throw new ZSAError("INTERNAL_SERVER_ERROR", "Failed to generate SEO description");
    }

    return { description };
  });
