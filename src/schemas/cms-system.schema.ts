import { z } from "zod";
import { zodCollectionEnum } from "@/../cms.config";

export const cmsSystemActionTypeSchema = z.enum([
  "rebuild-search-index",
  "clear-search-cache",
  "clear-cms-cache",
]);

export const cmsSystemActionSchema = z.object({
  type: cmsSystemActionTypeSchema,
  collection: zodCollectionEnum.optional(),
});

export type CmsSystemAction = z.infer<typeof cmsSystemActionSchema>;
export type CmsSystemActionType = z.infer<typeof cmsSystemActionTypeSchema>;
