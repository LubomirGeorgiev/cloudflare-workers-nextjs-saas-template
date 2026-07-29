import { requiredString, v } from "@/lib/validation";
import { cmsTranslationTargetFields } from "@/schemas/cms-translation.schema";

export const createCmsTagActionSchema = v.object({
  name: requiredString("Name is required"),
  slug: requiredString("Slug is required"),
  description: v.optional(v.string()),
  color: v.optional(v.string()),
});

export const updateCmsTagActionSchema = v.object({
  id: v.string(),
  name: v.optional(requiredString("Name is required")),
  slug: v.optional(requiredString("Slug is required")),
  description: v.optional(v.string()),
  color: v.optional(v.string()),
});

export const cmsTagIdSchema = v.object({ id: v.string() });

export const createCmsTagTranslationActionSchema = v.object({
  slug: requiredString("Slug is required"),
  ...cmsTranslationTargetFields,
});
