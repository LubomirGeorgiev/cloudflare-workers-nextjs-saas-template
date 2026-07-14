import { CMS_ENTRY_STATUS } from "@/app/enums";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";
import {
  baseCmsEntrySchema,
  cmsEntryStatusSchema,
  withPublishedAtLifecycleValidation,
} from "@/schemas/cms-entry.schema";
import { cmsStatusFilterTuple } from "@/types/cms";
import { requiredString, v } from "@/lib/validation";

const cmsEntryStatusOrAllSchema = v.picklist(cmsStatusFilterTuple);

// Translations of an entry share (collection, slug) and differ by locale. Defaulting to DEFAULT_LOCALE
// keeps existing callers on the canonical row. Validate against LOCALES (not
// ENABLED_LOCALES) so a valid catalog locale isn't rejected when i18n is off, while still rejecting garbage strings.
const cmsEntryLocaleSchema = v.optional(v.picklist(LOCALES), DEFAULT_LOCALE);

// Internal-only: the source-hash snapshot the mutation stamps onto a translation
// row (never sent by the entry form). Nullable so a row can be cleared back to "no
// baseline". See SourceContentHashes in types/cms.
const sourceContentHashesSchema = v.nullable(
  v.object({
    title: v.string(),
    seoDescription: v.string(),
    content: v.string(),
  })
);

const cmsIncludeRelationsSchema = v.optional(v.object({
  createdByUser: v.optional(v.boolean()),
  media: v.optional(v.boolean()),
  tags: v.optional(v.boolean()),
}));

// `allLocales: true` drops the locale `where` clause so the admin listing sees
// every locale's rows (e.g. a new translated DRAFT); public callers of `getCmsCollection`/
// `getCmsCollectionCount` omit it and stay locale-filtered by default.
const cmsAllLocalesSchema = v.optional(v.boolean(), false);

export const getCmsCollectionParamsSchema = v.object({
  collectionSlug: v.string(),
  status: v.optional(cmsEntryStatusOrAllSchema, CMS_ENTRY_STATUS.PUBLISHED),
  includeRelations: cmsIncludeRelationsSchema,
  limit: v.optional(v.pipe(v.number(), v.minValue(1))),
  offset: v.optional(v.pipe(v.number(), v.minValue(0))),
  locale: cmsEntryLocaleSchema,
  allLocales: cmsAllLocalesSchema,
});

export const getCmsCollectionCountParamsSchema = v.object({
  collectionSlug: v.string(),
  status: v.optional(cmsEntryStatusOrAllSchema, CMS_ENTRY_STATUS.PUBLISHED),
  locale: cmsEntryLocaleSchema,
  allLocales: cmsAllLocalesSchema,
});

export const getCmsEntryByIdParamsSchema = v.object({
  id: requiredString(),
  includeRelations: cmsIncludeRelationsSchema,
});

export const getCmsEntryBySlugParamsSchema = v.object({
  collectionSlug: v.string(),
  slug: requiredString(),
  status: v.optional(cmsEntryStatusOrAllSchema, CMS_ENTRY_STATUS.PUBLISHED),
  includeRelations: cmsIncludeRelationsSchema,
  locale: cmsEntryLocaleSchema,
});

export const getEntryLocalesParamsSchema = v.object({
  collectionSlug: v.string(),
  slug: requiredString(),
});

export const getEntryLocalesForSlugsParamsSchema = v.object({
  collectionSlug: v.string(),
  slugs: v.array(v.string()),
});

const cmsEntryBaseSchema = v.object({
  ...baseCmsEntrySchema.entries,
  fields: v.unknown(),
  status: v.optional(cmsEntryStatusSchema, CMS_ENTRY_STATUS.DRAFT),
});

export const createCmsEntryParamsSchema = withPublishedAtLifecycleValidation(
  v.object({
    ...cmsEntryBaseSchema.entries,
    collectionSlug: v.string(),
    createdBy: requiredString(),
  })
);

export const updateCmsEntryParamsSchema = withPublishedAtLifecycleValidation(
  v.object({
    title: v.optional(cmsEntryBaseSchema.entries.title),
    slug: v.optional(cmsEntryBaseSchema.entries.slug),
    content: v.optional(cmsEntryBaseSchema.entries.content),
    seoDescription: v.optional(cmsEntryBaseSchema.entries.seoDescription),
    status: v.optional(cmsEntryStatusSchema),
    publishedAt: v.optional(cmsEntryBaseSchema.entries.publishedAt),
    tagIds: v.optional(cmsEntryBaseSchema.entries.tagIds),
    featuredImageId: v.optional(cmsEntryBaseSchema.entries.featuredImageId),
    fields: v.optional(v.unknown()),
    sourceContentHashes: v.optional(sourceContentHashesSchema),
    id: requiredString(),
  })
);

export const deleteCmsEntryParamsSchema = v.object({
  id: requiredString(),
});

export const createCmsEntryTranslationParamsSchema = v.object({
  collectionSlug: v.string(),
  slug: requiredString(),
  // Both feed a row insert, so validate against the full locale catalog here —
  // the canonical write boundary — rather than trusting callers. Use LOCALES (not
  // ENABLED_LOCALES) so a valid source/target isn't rejected when i18n is off.
  sourceLocale: v.picklist(LOCALES),
  targetLocale: v.picklist(LOCALES),
  createdBy: requiredString(),
  // AI-translate the seeded copy by default; opt out for a verbatim copy.
  autoTranslate: v.optional(v.boolean(), true),
});

export const getCmsEntryVersionsParamsSchema = requiredString();

export const deleteCmsEntryVersionParamsSchema = v.object({
  entryId: requiredString(),
  versionId: requiredString(),
});

export const revertCmsEntryToVersionParamsSchema = v.object({
  entryId: requiredString(),
  versionId: requiredString(),
});
