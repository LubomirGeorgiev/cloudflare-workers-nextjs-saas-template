import { z } from "zod";
import { zodCollectionEnum } from "@/../cms.config";
import { CMS_ENTRY_STATUS } from "@/app/enums";
import { cmsEntryStatusTuple } from "@/types/cms";
import { CMS_SEO_DESCRIPTION_MAX_LENGTH } from "@/constants";

// Zod schema for CMS entry status validation
export const cmsEntryStatusSchema = z.enum(cmsEntryStatusTuple);

const baseCmsEntrySchema = z.object({
  title: z.string().min(1, "Title is required"),
  slug: z.string().min(1, "Slug is required"),
  content: z.any(),
  seoDescription: z.string().max(CMS_SEO_DESCRIPTION_MAX_LENGTH, `SEO description must be ${CMS_SEO_DESCRIPTION_MAX_LENGTH} characters or less`).optional(),
  status: cmsEntryStatusSchema.default(CMS_ENTRY_STATUS.DRAFT),
  publishedAt: z.coerce.date().optional(),
  tagIds: z.array(z.string()).optional(),
  featuredImageId: z.string().nullable().optional(),
});

// Helper function to add status/publishedAt validation
function withStatusPublishedAtValidation<T extends z.ZodTypeAny>(schema: T) {
  return schema
    .refine(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data: any) => {
        // If publishedAt is in the future, status must be scheduled
        if (data.publishedAt) {
          const publishDate = new Date(data.publishedAt);
          const now = new Date();
          if (publishDate > now) {
            return data.status === CMS_ENTRY_STATUS.SCHEDULED;
          }
        }
        return true;
      },
      {
        message: "Status must be 'scheduled' when publishedAt is set to a future date",
        path: ['status'],
      }
    )
    .refine(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data: any) => {
        // If status is scheduled, publishedAt must be provided and in the future
        if (data.status === CMS_ENTRY_STATUS.SCHEDULED) {
          if (!data.publishedAt) {
            return false;
          }
          const publishDate = new Date(data.publishedAt);
          const now = new Date();
          return publishDate > now;
        }
        return true;
      },
      {
        message: "A future publish date is required for scheduled entries",
        path: ['publishedAt'],
      }
    );
}

export const cmsEntryFormSchema = withStatusPublishedAtValidation(
  baseCmsEntrySchema.extend({
    fields: z.record(z.any()).optional(),
  })
);

export const createCmsEntrySchema = withStatusPublishedAtValidation(
  baseCmsEntrySchema.extend({
    collection: zodCollectionEnum,
    fields: z.record(z.any()),
  })
);

export const updateCmsEntrySchema = withStatusPublishedAtValidation(
  baseCmsEntrySchema
    .extend({
      fields: z.record(z.any()),
    })
    .partial()
    .extend({
      id: z.string(),
    })
);
export type CmsEntryFormData = z.infer<typeof cmsEntryFormSchema>;
