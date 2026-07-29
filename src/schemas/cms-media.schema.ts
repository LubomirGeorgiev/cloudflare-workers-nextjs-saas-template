import { requiredString, v } from "@/lib/validation";

// Admin media browser: a generous page size, since the grid renders thumbnails.
export const listCmsMediaSchema = v.object({
  page: v.optional(v.pipe(v.number(), v.minValue(1)), 1),
  limit: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(100)), 20),
});

// The entry-form picker is a modal with a search box and a tighter page cap.
export const listCmsMediaForPickerSchema = v.object({
  page: v.optional(v.pipe(v.number(), v.minValue(1)), 1),
  limit: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(50)), 20),
  search: v.optional(v.string()),
});

export const cmsMediaIdSchema = v.object({
  mediaId: v.string(),
});

export const cmsMediaBucketKeySchema = v.object({
  bucketKey: v.string(),
});

export const updateCmsMediaSchema = v.object({
  mediaId: v.string(),
  alt: v.optional(v.string()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
});

export const uploadImageSchema = v.object({
  file: v.instance(File),
  collection: requiredString("Collection slug is required"),
});
