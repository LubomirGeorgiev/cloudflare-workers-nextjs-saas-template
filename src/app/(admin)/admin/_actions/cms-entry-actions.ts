"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { requireAdmin } from "@/utils/auth";
import { cmsConfig, zodCollectionEnum, type CollectionsUnion } from "@/../cms.config";
import { createCmsEntrySchema, updateCmsEntrySchema } from "@/schemas/cms-entry.schema";
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

function revalidateCmsEntryPaths({
  collection,
  entryId,
  slugs,
  includeCreatePath = false,
}: {
  collection: CollectionsUnion;
  entryId: string;
  slugs: string[];
  includeCreatePath?: boolean;
}) {
  revalidatePath("/admin/cms");
  revalidatePath(`/admin/cms/${collection}`);
  revalidatePath(`/admin/cms/${collection}/${entryId}`);

  if (includeCreatePath) {
    revalidatePath(`/admin/cms/${collection}/new`);
  }

  const collectionConfig = cmsConfig.collections[collection];
  const previewUrlBuilder = "previewUrl" in collectionConfig ? collectionConfig.previewUrl : undefined;

  if (!previewUrlBuilder) {
    return;
  }

  for (const slug of new Set(slugs.filter(Boolean))) {
    revalidatePath(previewUrlBuilder(slug));
  }
}

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

    revalidateCmsEntryPaths({
      collection: input.collection as CollectionsUnion,
      entryId: newEntry.id,
      slugs: [newEntry.slug],
      includeCreatePath: true,
    });

    return newEntry;
  });

export const updateCmsEntryAction = actionClient
  .inputSchema(updateCmsEntrySchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const previousEntry = await getCmsEntryById({ id: input.id });
    const updatedEntry = await updateCmsEntry(input);

    if (!updatedEntry) {
      throw new ActionError("NOT_FOUND", "Entry not found");
    }

    revalidateCmsEntryPaths({
      collection: updatedEntry.collection as CollectionsUnion,
      entryId: updatedEntry.id,
      slugs: [previousEntry?.slug, updatedEntry.slug].filter((slug): slug is string => Boolean(slug)),
    });

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
