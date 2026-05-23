import { collectionSchema } from "@/../cms.config";
import { v } from "@/lib/validation";

// oxlint-disable-next-line project/no-unused-module-exports -- Schemas intentionally export validation contracts and inferred types together.
export const cmsSystemActionTypeSchema = v.picklist([
  "rebuild-search-index",
  "clear-search-cache",
  "clear-cms-cache",
]);

export const cmsSystemActionSchema = v.object({
  type: cmsSystemActionTypeSchema,
  collection: v.optional(collectionSchema),
});

// oxlint-disable-next-line project/no-unused-module-exports -- Schemas intentionally export validation contracts and inferred types together.
export type CmsSystemAction = v.InferOutput<typeof cmsSystemActionSchema>;
// oxlint-disable-next-line project/no-unused-module-exports -- Schemas intentionally export validation contracts and inferred types together.
export type CmsSystemActionType = v.InferOutput<typeof cmsSystemActionTypeSchema>;
