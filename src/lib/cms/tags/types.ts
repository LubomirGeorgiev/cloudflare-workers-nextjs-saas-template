import type { InferOutput } from "valibot";

import type { CmsTag } from "@/db/schema";
import type { Locale } from "@/i18n/config";
import type {
  CmsStatusFilter,
} from "@/types/cms";
import type {
  createCmsTagParamsSchema,
  createCmsTagTranslationParamsSchema,
  deleteCmsTagParamsSchema,
  updateCmsTagParamsSchema,
} from "@/lib/cms/tags/schemas";

export type GetCmsTagsParams = {
  locale?: Locale;
};

export type GetCmsEntriesByTagIdParams = {
  tagId: string;
  status?: CmsStatusFilter;
};

export type CreateCmsTagParams = InferOutput<typeof createCmsTagParamsSchema>;

export type UpdateCmsTagParams = InferOutput<typeof updateCmsTagParamsSchema>;

export type DeleteCmsTagParams = InferOutput<typeof deleteCmsTagParamsSchema>;

export type CreateCmsTagTranslationParams = Omit<
  InferOutput<typeof createCmsTagTranslationParamsSchema>,
  "autoTranslate"
> & {
  autoTranslate?: boolean;
};

export type CmsEntryTagsForDisplay = Array<{ tag: CmsTag }>;

// A single locale row in a tag's translation group, for the admin translations
// panel to link to existing siblings and offer to create the missing ones.
export interface CmsTagLocaleSibling {
  id: string;
  locale: Locale;
  name: string;
}
