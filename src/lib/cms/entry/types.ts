import type { JSONContent } from "@tiptap/core";
import type { InferOutput } from "valibot";

import type { CollectionsUnion } from "@/../cms.config";
import type { CmsEntry, CmsTag } from "@/db/schema";
import type { Locale } from "@/i18n/config";
import type {
  CmsEntryStatus,
  CmsStatusFilter,
  TranslatableEntryField,
} from "@/types/cms";
import type {
  createCmsEntryParamsSchema,
  createCmsEntryTranslationParamsSchema,
  deleteCmsEntryParamsSchema,
  getCmsCollectionCountParamsSchema,
  getCmsCollectionParamsSchema,
  getCmsEntryByIdParamsSchema,
  getCmsEntryBySlugParamsSchema,
  getEntryLocalesForSlugsParamsSchema,
  getEntryLocalesParamsSchema,
  updateCmsEntryParamsSchema,
} from "@/lib/cms/entry/schemas";

export type GetCmsCollectionParams<T extends CollectionsUnion> = Omit<
  InferOutput<typeof getCmsCollectionParamsSchema>,
  "collectionSlug" | "status" | "locale" | "allLocales"
> & {
  collectionSlug: T;
  status?: CmsStatusFilter;
  locale?: Locale;
  // See schemas.ts `cmsAllLocalesSchema` — opts an admin-only caller out of
  // locale filtering. Public callers must omit this (defaults to false).
  allLocales?: boolean;
};

export type GetCmsCollectionCountParams<T extends CollectionsUnion> = Omit<
  InferOutput<typeof getCmsCollectionCountParamsSchema>,
  "locale" | "allLocales"
> & {
  collectionSlug: T;
  locale?: Locale;
  allLocales?: boolean;
};

export type GetCmsEntryByIdParams = InferOutput<typeof getCmsEntryByIdParamsSchema>;

export type GetCmsEntryBySlugParams<T extends CollectionsUnion> = Omit<
  InferOutput<typeof getCmsEntryBySlugParamsSchema>,
  "collectionSlug" | "status" | "locale"
> & {
  collectionSlug: T;
  status?: CmsStatusFilter;
  locale?: Locale;
};

export type CreateCmsEntryParams<T extends CollectionsUnion> =
  InferOutput<typeof createCmsEntryParamsSchema> & {
    collectionSlug: T;
    content: JSONContent;
  };

export type UpdateCmsEntryParams = InferOutput<typeof updateCmsEntryParamsSchema> & {
  content?: JSONContent;
};

export type DeleteCmsEntryParams = InferOutput<typeof deleteCmsEntryParamsSchema>;

export type CreateCmsEntryTranslationParams = Omit<
  InferOutput<typeof createCmsEntryTranslationParamsSchema>,
  "collectionSlug" | "autoTranslate"
> & {
  collectionSlug: CollectionsUnion;
  // Optional for callers (defaults to true in the schema); v.parse fills it in.
  autoTranslate?: boolean;
};

export type GetEntryLocalesParams = InferOutput<typeof getEntryLocalesParamsSchema>;

export type GetEntryLocalesForSlugsParams = InferOutput<
  typeof getEntryLocalesForSlugsParamsSchema
>;

// A single locale row in a (collection, slug) translation group, used by the
// editor locale switcher to link to (or offer to create) each locale.
export interface CmsEntryLocaleSibling {
  id: string;
  locale: Locale;
  status: CmsEntryStatus;
  // Whether this locale row's content has drifted from the source since it was
  // translated, and which fields specifically — powers the editor's stale badge and
  // banner. The source (default-locale) row is always isStale: false.
  isStale: boolean;
  staleFields: TranslatableEntryField[];
}

export type GetCmsEntryBySlugResult = GetCmsCollectionResult;

export type GetCmsCollectionResult = CmsEntry & {
  status: CmsEntryStatus;
  createdByUser?: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    avatar: string | null;
  };
  featuredImage?: {
    id: string;
    fileName: string;
    mimeType: string;
    sizeInBytes: number;
    bucketKey: string;
    width: number | null;
    height: number | null;
    alt: string | null;
  } | null;
  featuredImageUrl?: string | null;
  entryMedia?: Array<{
    id: string;
    position: number | null;
    caption: string | null;
    media: {
      id: string;
      fileName: string;
      mimeType: string;
      sizeInBytes: number;
      bucketKey: string;
      width: number | null;
      height: number | null;
      alt: string | null;
    };
  }>;
  tags?: Array<{
    tag: CmsTag;
  }>;
};

// List/collection reads never render the entry body, so `getCmsCollection` drops the
// heavy `content` and `fields` JSON columns from its projection. This is the shape
// those callers (blog/docs listings, admin table, nav tree, sitemap) actually get;
// single-entry readers (`getCmsEntryBySlug`) still return the full `GetCmsCollectionResult`.
export type CmsCollectionListItem = Omit<GetCmsCollectionResult, "content" | "fields">;
