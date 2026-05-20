import { z } from "zod";
import { zodCollectionEnum } from "@/../cms.config";

// oxlint-disable-next-line project/no-unused-module-exports -- Schemas intentionally export validation contracts and inferred types together.
export const cmsSystemActionTypeSchema = z.enum([
  "rebuild-search-index",
  "clear-search-cache",
  "clear-cms-cache",
]);

export const cmsSystemActionSchema = z.object({
  type: cmsSystemActionTypeSchema,
  collection: zodCollectionEnum.optional(),
});

// oxlint-disable-next-line project/no-unused-module-exports -- Schemas intentionally export validation contracts and inferred types together.
export type CmsSystemAction = z.infer<typeof cmsSystemActionSchema>;
// oxlint-disable-next-line project/no-unused-module-exports -- Schemas intentionally export validation contracts and inferred types together.
export type CmsSystemActionType = z.infer<typeof cmsSystemActionTypeSchema>;
