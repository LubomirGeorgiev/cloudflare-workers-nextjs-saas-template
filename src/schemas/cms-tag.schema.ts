import {
  CMS_TAG_COLOR_MAX_LENGTH,
  CMS_TAG_DESCRIPTION_MAX_LENGTH,
  CMS_TAG_NAME_MAX_LENGTH,
} from "@/constants";
import { maxString, trimmedString, v } from "@/lib/validation";
import { cmsTranslationTargetFields } from "@/schemas/cms-translation.schema";
import { idField, slugField } from "@/schemas/fields";

const tagNameField = trimmedString({ min: 1, max: CMS_TAG_NAME_MAX_LENGTH, minMessage: "Name is required" });
const tagDescriptionField = maxString(CMS_TAG_DESCRIPTION_MAX_LENGTH);
// A CSS color token, not free text.
const tagColorField = maxString(CMS_TAG_COLOR_MAX_LENGTH);

export const createCmsTagActionSchema = v.object({
  name: tagNameField,
  slug: slugField("Slug is required"),
  description: v.optional(tagDescriptionField),
  color: v.optional(tagColorField),
});

export const updateCmsTagActionSchema = v.object({
  id: idField(),
  name: v.optional(tagNameField),
  slug: v.optional(slugField("Slug is required")),
  description: v.optional(tagDescriptionField),
  color: v.optional(tagColorField),
});

export const cmsTagIdSchema = v.object({ id: idField() });

export const createCmsTagTranslationActionSchema = v.object({
  slug: slugField("Slug is required"),
  ...cmsTranslationTargetFields,
});
