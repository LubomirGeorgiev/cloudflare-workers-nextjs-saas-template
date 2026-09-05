import "server-only";

import type { JSONContent } from "@tiptap/core";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import {
  buildCmsHtmlArtifacts,
  keepRendererBuildIdInCacheKey,
  type CmsHtmlArtifacts,
} from "@/lib/cms/cms-entry-artifacts";
import { cmsRendererBuildId } from "@/lib/cms/cms-renderer-build-id";
import { getCmsEntryBySlug, type GetCmsCollectionResult } from "@/lib/cms/entry";
import { generateMetaDescription } from "@/lib/cms/extract-text-from-content";
import { CACHE_TAGS, setCacheScope } from "@/utils/cache";
import type { Locale } from "@/i18n/config";

const BLOG_COLLECTION_SLUG = "blog" as const;

// The blog post page and its metadata read exactly these fields. The TipTap `content`
// and `fields` JSON stay out, so the cached HTML entry does not carry the body twice.
export interface BlogEntryArtifacts extends CmsHtmlArtifacts, Pick<
  GetCmsCollectionResult,
  | "createdAt"
  | "createdByUser"
  | "featuredImage"
  | "featuredImageUrl"
  | "locale"
  | "publishedAt"
  | "slug"
  | "tags"
  | "title"
  | "updatedAt"
> {
  description: string;
}

export async function buildBlogEntryArtifacts({
  entry,
}: {
  entry: GetCmsCollectionResult;
}): Promise<BlogEntryArtifacts> {
  const content = entry.content as JSONContent;

  return {
    ...(await buildCmsHtmlArtifacts({ content })),
    createdAt: entry.createdAt,
    createdByUser: entry.createdByUser,
    description: entry.seoDescription || generateMetaDescription(content),
    featuredImage: entry.featuredImage,
    featuredImageUrl: entry.featuredImageUrl,
    locale: entry.locale,
    publishedAt: entry.publishedAt,
    slug: entry.slug,
    tags: entry.tags,
    title: entry.title,
    updatedAt: entry.updatedAt,
  };
}

export async function getCachedBlogEntryArtifacts({
  locale,
  slug,
}: {
  locale: Locale;
  slug: string;
}) {
  return loadCachedBlogEntryArtifacts({
    locale,
    slug,
    rendererBuildId: cmsRendererBuildId(),
  });
}

async function loadCachedBlogEntryArtifacts({
  locale,
  slug,
  rendererBuildId,
}: {
  locale: Locale;
  slug: string;
  rendererBuildId: string;
}): Promise<BlogEntryArtifacts | null> {
  "use cache: remote";
  keepRendererBuildIdInCacheKey(rendererBuildId);
  setCacheScope({
    tags: [
      CACHE_TAGS.cmsEntry({ collectionSlug: BLOG_COLLECTION_SLUG, slug }),
    ],
    ttl: "8 hours",
  });

  const entry = await getCmsEntryBySlug({
    collectionSlug: BLOG_COLLECTION_SLUG,
    slug,
    locale,
    status: CMS_ENTRY_STATUS.PUBLISHED,
    includeRelations: { tags: true, createdByUser: true },
  });

  if (!entry) {
    return null;
  }

  return buildBlogEntryArtifacts({ entry });
}
