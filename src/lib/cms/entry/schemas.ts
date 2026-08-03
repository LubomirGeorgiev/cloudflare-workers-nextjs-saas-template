import { CMS_ENTRY_STATUS } from "@/app/enums";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";
import {
  baseCmsEntrySchema,
  cmsEntryStatusSchema,
  withPublishedAtLifecycleValidation,
} from "@/schemas/cms-entry.schema";
import { cmsStatusFilterTuple } from "@/types/cms";
import { CMS_MAX_SLUGS_PER_LOOKUP, ID_MAX_LENGTH, SLUG_MAX_LENGTH } from "@/constants";
import { maxString, v } from "@/lib/validation";
import { idField, slugField } from "@/schemas/fields";

// Repository params, not request bodies — but this is the canonical write boundary, so its
// strings are bounded like every caller-supplied one rather than trusting the layer above.
const collectionSlugField = maxString(SLUG_MAX_LENGTH);

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
    title: maxString(ID_MAX_LENGTH),
    seoDescription: maxString(ID_MAX_LENGTH),
    content: maxString(ID_MAX_LENGTH),
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
  collectionSlug: collectionSlugField,
  status: v.optional(cmsEntryStatusOrAllSchema, CMS_ENTRY_STATUS.PUBLISHED),
  includeRelations: cmsIncludeRelationsSchema,
  limit: v.optional(v.pipe(v.number(), v.minValue(1))),
  offset: v.optional(v.pipe(v.number(), v.minValue(0))),
  locale: cmsEntryLocaleSchema,
  allLocales: cmsAllLocalesSchema,
});

export const getCmsCollectionCountParamsSchema = v.object({
  collectionSlug: collectionSlugField,
  status: v.optional(cmsEntryStatusOrAllSchema, CMS_ENTRY_STATUS.PUBLISHED),
  locale: cmsEntryLocaleSchema,
  allLocales: cmsAllLocalesSchema,
});

export const getCmsEntryByIdParamsSchema = v.object({
  id: idField(),
  includeRelations: cmsIncludeRelationsSchema,
});

export const getCmsEntryBySlugParamsSchema = v.object({
  collectionSlug: collectionSlugField,
  slug: slugField(),
  status: v.optional(cmsEntryStatusOrAllSchema, CMS_ENTRY_STATUS.PUBLISHED),
  includeRelations: cmsIncludeRelationsSchema,
  locale: cmsEntryLocaleSchema,
});

export const getEntryLocalesParamsSchema = v.object({
  collectionSlug: collectionSlugField,
  slug: slugField(),
});

export const getEntryLocalesForSlugsParamsSchema = v.object({
  collectionSlug: collectionSlugField,
  slugs: v.pipe(v.array(slugField()), v.maxLength(CMS_MAX_SLUGS_PER_LOOKUP)),
});

const cmsEntryBaseSchema = v.object({
  ...baseCmsEntrySchema.entries,
  fields: v.unknown(),
  status: v.optional(cmsEntryStatusSchema, CMS_ENTRY_STATUS.DRAFT),
});

export const createCmsEntryParamsSchema = withPublishedAtLifecycleValidation(
  v.object({
    ...cmsEntryBaseSchema.entries,
    collectionSlug: collectionSlugField,
    createdBy: idField(),
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
    id: idField(),
  })
);

export const deleteCmsEntryParamsSchema = v.object({
  id: idField(),
});

export const createCmsEntryTranslationParamsSchema = v.object({
  collectionSlug: collectionSlugField,
  slug: slugField(),
  // Both feed a row insert, so validate against the full locale catalog here —
  // the canonical write boundary — rather than trusting callers. Use LOCALES (not
  // ENABLED_LOCALES) so a valid source/target isn't rejected when i18n is off.
  sourceLocale: v.picklist(LOCALES),
  targetLocale: v.picklist(LOCALES),
  createdBy: idField(),
  // AI-translate the seeded copy by default; opt out for a verbatim copy.
  autoTranslate: v.optional(v.boolean(), true),
});

export const getCmsEntryVersionsParamsSchema = idField();

export const deleteCmsEntryVersionParamsSchema = v.object({
  entryId: idField(),
  versionId: idField(),
});

export const revertCmsEntryToVersionParamsSchema = v.object({
  entryId: idField(),
  versionId: idField(),
});
