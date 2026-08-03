import { CMS_MEDIA_ALT_MAX_LENGTH, SEARCH_QUERY_MAX_LENGTH, SLUG_MAX_LENGTH } from "@/constants";
import { maxString, minMaxString, v } from "@/lib/validation";
import { idField } from "@/schemas/fields";

// Admin media browser: a generous page size, since the grid renders thumbnails.
export const listCmsMediaSchema = v.object({
  page: v.optional(v.pipe(v.number(), v.minValue(1)), 1),
  limit: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(100)), 20),
});

// The entry-form picker is a modal with a search box and a tighter page cap.
export const listCmsMediaForPickerSchema = v.object({
  page: v.optional(v.pipe(v.number(), v.minValue(1)), 1),
  limit: v.optional(v.pipe(v.number(), v.minValue(1), v.maxValue(50)), 20),
  search: v.optional(maxString(SEARCH_QUERY_MAX_LENGTH)),
});

export const cmsMediaIdSchema = v.object({
  mediaId: idField(),
});

export const cmsMediaBucketKeySchema = v.object({
  // An R2 object key; R2 caps keys at 1024 bytes, well above any key this app writes.
  bucketKey: maxString(SLUG_MAX_LENGTH),
});

export const updateCmsMediaSchema = v.object({
  mediaId: idField(),
  alt: v.optional(maxString(CMS_MEDIA_ALT_MAX_LENGTH)),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
});

export const uploadImageSchema = v.object({
  file: v.instance(File),
  collection: minMaxString({ min: 1, max: SLUG_MAX_LENGTH, minMessage: "Collection slug is required" }),
});
