import { LOCALES } from "@/i18n/config";
import {
  CMS_STATUS_FILTER_ALL,
  cmsStatusFilterTuple,
} from "@/types/cms";
import { requiredString, v } from "@/lib/validation";

const cmsTagStatusOrAllSchema = v.picklist(cmsStatusFilterTuple);

export const getCmsTagByIdParamsSchema = requiredString();

export const getCmsEntriesByTagIdParamsSchema = v.object({
  tagId: requiredString(),
  status: v.optional(cmsTagStatusOrAllSchema, CMS_STATUS_FILTER_ALL),
});

// Tags follow a canonical + translations model: the DEFAULT_LOCALE row is the
// canonical tag that entries link to (the junction stores its id); other-locale
// rows share the same `slug` and only translate `name`/`description`.
export const createCmsTagParamsSchema = v.object({
  name: requiredString(),
  slug: requiredString(),
  description: v.optional(v.string()),
  color: v.optional(v.string()),
  createdBy: requiredString(),
});

export const updateCmsTagParamsSchema = v.object({
  id: requiredString(),
  name: v.optional(requiredString()),
  slug: v.optional(requiredString()),
  description: v.optional(v.string()),
  color: v.optional(v.string()),
});

export const deleteCmsTagParamsSchema = requiredString();

export const createCmsTagTranslationParamsSchema = v.object({
  slug: requiredString(),
  // Both feed a tag row insert, so validate against the full locale catalog here —
  // the canonical write boundary — rather than casting raw strings downstream. Use
  // LOCALES (not ENABLED_LOCALES) so a valid source/target isn't rejected when i18n
  // is off.
  sourceLocale: v.picklist(LOCALES),
  targetLocale: v.picklist(LOCALES),
  createdBy: requiredString(),
  // AI-translate the seeded copy by default; opt out for a verbatim copy.
  autoTranslate: v.optional(v.boolean(), true),
});

export const getCmsTagLocaleSiblingsParamsSchema = requiredString();
