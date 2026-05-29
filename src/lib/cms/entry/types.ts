import type { JSONContent } from "@tiptap/core";
import type { InferOutput } from "valibot";

import type { CollectionsUnion } from "@/../cms.config";
import type { CmsEntry, CmsTag } from "@/db/schema";
import type {
  CmsEntryStatus,
  CmsStatusFilter,
} from "@/types/cms";
import type {
  createCmsEntryParamsSchema,
  deleteCmsEntryParamsSchema,
  getCmsCollectionCountParamsSchema,
  getCmsCollectionParamsSchema,
  getCmsEntryByIdParamsSchema,
  getCmsEntryBySlugParamsSchema,
  updateCmsEntryParamsSchema,
} from "@/lib/cms/entry/schemas";

export type GetCmsCollectionParams<T extends CollectionsUnion> = Omit<
  InferOutput<typeof getCmsCollectionParamsSchema>,
  "collectionSlug" | "status"
> & {
  collectionSlug: T;
  status?: CmsStatusFilter;
};

export type GetCmsCollectionCountParams<T extends CollectionsUnion> =
  InferOutput<typeof getCmsCollectionCountParamsSchema> & {
    collectionSlug: T;
  };

export type GetCmsEntryByIdParams = InferOutput<typeof getCmsEntryByIdParamsSchema>;

export type GetCmsEntryBySlugParams<T extends CollectionsUnion> = Omit<
  InferOutput<typeof getCmsEntryBySlugParamsSchema>,
  "collectionSlug" | "status"
> & {
  collectionSlug: T;
  status?: CmsStatusFilter;
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
