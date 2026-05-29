import { CMS_ENTRY_STATUS } from "@/app/enums";
import {
  baseCmsEntrySchema,
  cmsEntryStatusSchema,
  withPublishedAtLifecycleValidation,
} from "@/schemas/cms-entry.schema";
import { cmsStatusFilterTuple } from "@/types/cms";
import { requiredString, v } from "@/lib/validation";

const cmsEntryStatusOrAllSchema = v.picklist(cmsStatusFilterTuple);

const cmsIncludeRelationsSchema = v.optional(v.object({
  createdByUser: v.optional(v.boolean()),
  media: v.optional(v.boolean()),
  tags: v.optional(v.boolean()),
}));

export const getCmsCollectionParamsSchema = v.object({
  collectionSlug: v.string(),
  status: v.optional(cmsEntryStatusOrAllSchema, CMS_ENTRY_STATUS.PUBLISHED),
  includeRelations: cmsIncludeRelationsSchema,
  limit: v.optional(v.pipe(v.number(), v.minValue(1))),
  offset: v.optional(v.pipe(v.number(), v.minValue(0))),
});

export const getCmsCollectionCountParamsSchema = v.object({
  collectionSlug: v.string(),
  status: v.optional(cmsEntryStatusOrAllSchema, CMS_ENTRY_STATUS.PUBLISHED),
});

export const getCmsEntryByIdParamsSchema = v.object({
  id: requiredString(),
  includeRelations: cmsIncludeRelationsSchema,
});

export const getCmsEntryBySlugParamsSchema = v.object({
  collectionSlug: v.string(),
  slug: requiredString(),
  status: v.optional(cmsEntryStatusOrAllSchema, CMS_ENTRY_STATUS.PUBLISHED),
  includeRelations: cmsIncludeRelationsSchema,
});

const cmsEntryBaseSchema = v.object({
  ...baseCmsEntrySchema.entries,
  fields: v.unknown(),
  status: v.optional(cmsEntryStatusSchema, CMS_ENTRY_STATUS.DRAFT),
});

export const createCmsEntryParamsSchema = withPublishedAtLifecycleValidation(
  v.object({
    ...cmsEntryBaseSchema.entries,
    collectionSlug: v.string(),
    createdBy: requiredString(),
  })
);

export const updateCmsEntryParamsSchema = withPublishedAtLifecycleValidation(
  v.object({
    title: v.optional(cmsEntryBaseSchema.entries.title),
    slug: v.optional(cmsEntryBaseSchema.entries.slug),
    content: v.optional(cmsEntryBaseSchema.entries.content),
    seoDescription: v.optional(cmsEntryBaseSchema.entries.seoDescription),
    status: v.optional(cmsEntryStatusSchema),
    publishedAt: v.optional(cmsEntryBaseSchema.entries.publishedAt),
    tagIds: v.optional(cmsEntryBaseSchema.entries.tagIds),
    featuredImageId: v.optional(cmsEntryBaseSchema.entries.featuredImageId),
    fields: v.optional(v.unknown()),
    id: requiredString(),
  })
);

export const deleteCmsEntryParamsSchema = v.object({
  id: requiredString(),
});

export const getCmsEntryVersionsParamsSchema = requiredString();

export const deleteCmsEntryVersionParamsSchema = v.object({
  entryId: requiredString(),
  versionId: requiredString(),
});

export const revertCmsEntryToVersionParamsSchema = v.object({
  entryId: requiredString(),
  versionId: requiredString(),
});
