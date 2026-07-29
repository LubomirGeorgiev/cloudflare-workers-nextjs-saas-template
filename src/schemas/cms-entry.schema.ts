import { collectionSchema } from "@/../cms.config";
import { CMS_ENTRY_STATUS } from "@/app/enums";
import { cmsEntryStatusTuple, cmsStatusFilterTuple } from "@/types/cms";
import { CMS_SEO_DESCRIPTION_MAX_LENGTH } from "@/constants";
import { coerceDate, maxString, requiredString, v, validationKey } from "@/lib/validation";
import { cmsTranslationTargetFields } from "@/schemas/cms-translation.schema";

export const cmsEntryStatusSchema = v.picklist(cmsEntryStatusTuple);

export const baseCmsEntrySchema = v.object({
  title: requiredString(validationKey("titleRequired")),
  slug: requiredString(validationKey("slugRequired")),
  content: v.any(),
  // Falls back to the central keyed `maxLength` default; the max is still encoded via
  // `maxString`, so the rendered message keeps the field-specific number.
  seoDescription: v.optional(maxString(CMS_SEO_DESCRIPTION_MAX_LENGTH)),
  status: v.optional(cmsEntryStatusSchema, CMS_ENTRY_STATUS.DRAFT),
  publishedAt: v.optional(coerceDate()),
  tagIds: v.optional(v.array(v.string())),
  featuredImageId: v.optional(v.nullable(v.string())),
});

type CmsEntryScheduleFields = {
  status?: string;
  publishedAt?: Date | string | number;
};

function withStatusPublishedAtValidation<T extends v.GenericSchema>(schema: T) {
  return v.pipe(
    schema as v.GenericSchema<Record<string, unknown>>,
    v.forward(
      v.check(
      (data) => {
        const entry = data as CmsEntryScheduleFields;

        // If publishedAt is in the future, status must be scheduled
        if (entry.publishedAt) {
          const publishDate = new Date(entry.publishedAt);
          const now = new Date();
          if (publishDate > now) {
            return entry.status === CMS_ENTRY_STATUS.SCHEDULED;
          }
        }
        return true;
      },
        validationKey("scheduledStatusRequiresFutureDate")
      ),
      ["status"]
    ),
    v.forward(
      v.check(
      (data) => {
        const entry = data as CmsEntryScheduleFields;

        // If status is scheduled, publishedAt must be provided and in the future
        if (entry.status === CMS_ENTRY_STATUS.SCHEDULED) {
          if (!entry.publishedAt) {
            return false;
          }
          const publishDate = new Date(entry.publishedAt);
          const now = new Date();
          return publishDate > now;
        }
        return true;
      },
        validationKey("scheduledRequiresFuturePublishDate")
      ),
      ["publishedAt"]
    )
  ) as unknown as T;
}

export function withPublishedAtLifecycleValidation<T extends v.GenericSchema>(schema: T) {
  return v.pipe(
    withStatusPublishedAtValidation(schema) as v.GenericSchema<Record<string, unknown>>,
    v.transform((data) => {
      const entry = data as CmsEntryScheduleFields;

      if (entry.status === CMS_ENTRY_STATUS.PUBLISHED && !entry.publishedAt) {
        return { ...data, publishedAt: new Date() };
      }

      return data;
    })
  ) as unknown as T;
}

export const cmsEntryFormSchema = withStatusPublishedAtValidation(
  v.object({
    ...baseCmsEntrySchema.entries,
    fields: v.optional(v.record(v.string(), v.any())),
  })
);

export const createCmsEntrySchema = withStatusPublishedAtValidation(
  v.object({
    ...baseCmsEntrySchema.entries,
    collection: collectionSchema,
    fields: v.record(v.string(), v.any()),
  })
);

export const updateCmsEntrySchema = withStatusPublishedAtValidation(
  v.object({
    title: v.optional(baseCmsEntrySchema.entries.title),
    slug: v.optional(baseCmsEntrySchema.entries.slug),
    content: v.optional(baseCmsEntrySchema.entries.content),
    seoDescription: v.optional(baseCmsEntrySchema.entries.seoDescription),
    status: v.optional(cmsEntryStatusSchema),
    publishedAt: v.optional(coerceDate()),
    tagIds: v.optional(baseCmsEntrySchema.entries.tagIds),
    featuredImageId: v.optional(baseCmsEntrySchema.entries.featuredImageId),
    fields: v.optional(v.record(v.string(), v.any())),
    id: v.string(),
  })
);
export type CmsEntryFormInput = v.InferInput<typeof cmsEntryFormSchema>;
export type CmsEntryFormData = v.InferOutput<typeof cmsEntryFormSchema>;

export const listCmsEntriesSchema = v.object({
  collection: collectionSchema,
  status: v.optional(v.picklist(cmsStatusFilterTuple), "all"),
  limit: v.optional(v.number(), 20),
  offset: v.optional(v.number(), 0),
});

export const cmsEntryIdSchema = v.object({ id: v.string() });

// Distinct from cmsEntryIdSchema: these actions surface the id in an admin error toast,
// so the id carries its own required message.
export const requiredCmsEntryIdSchema = v.object({
  id: requiredString("Entry ID is required"),
});

export const createCmsEntryTranslationActionSchema = v.object({
  collection: collectionSchema,
  slug: requiredString("Slug is required"),
  ...cmsTranslationTargetFields,
});
