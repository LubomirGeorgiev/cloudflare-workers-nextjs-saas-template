import "server-only";

import type { JSONContent } from "@tiptap/core";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { cmsRendererBuildId } from "@/lib/cms/cms-renderer-build-id";
import {
  buildCmsHtmlArtifacts,
  keepRendererBuildIdInCacheKey,
  type CmsHtmlArtifacts,
} from "@/lib/cms/cms-entry-artifacts";
import { getCmsEntryBySlug, type GetCmsCollectionResult } from "@/lib/cms/entry";
import { CACHE_TAGS, setCacheScope } from "@/utils/cache";
import { absoluteLocalizedUrl } from "@/utils/i18n-urls";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import type { CollectionsUnion } from "@/../cms.config";

// The author and tag lines belong to the frame, so the copy button must load the same relations as
// `GET <path>.md`. Without them the two surfaces would hand the reader different documents.
const MARKDOWN_FRAME_RELATIONS = { createdByUser: true, tags: true } as const;

interface GetCachedDocsEntryArtifactsParams {
  collectionSlug: CollectionsUnion;
  locale: Locale;
  slug: string;
  /** Unlocalized page path of the entry, which becomes the `Source:` line. */
  sourcePathname: string;
}

interface DocsEntryArtifacts extends CmsHtmlArtifacts {
  markdown: string;
}

export async function buildDocsEntryArtifacts({
  entry,
  sourceUrl,
}: {
  entry: GetCmsCollectionResult;
  sourceUrl: string;
}): Promise<DocsEntryArtifacts> {
  const [{ buildCmsEntryMarkdown }, htmlArtifacts] = await Promise.all([
    import("@/lib/cms/build-cms-entry-markdown-response"),
    buildCmsHtmlArtifacts({ content: entry.content as JSONContent }),
  ]);

  return {
    ...htmlArtifacts,
    markdown: buildCmsEntryMarkdown({ entry, sourceUrl }),
  };
}

export async function getCachedDocsEntryArtifacts({
  collectionSlug,
  locale,
  slug,
  sourcePathname,
}: GetCachedDocsEntryArtifactsParams) {
  return loadCachedDocsEntryArtifacts({
    collectionSlug,
    locale,
    slug,
    sourcePathname,
    rendererBuildId: cmsRendererBuildId(),
  });
}

async function loadCachedDocsEntryArtifacts({
  collectionSlug,
  locale,
  slug,
  sourcePathname,
  rendererBuildId,
}: GetCachedDocsEntryArtifactsParams & { rendererBuildId: string }): Promise<DocsEntryArtifacts | null> {
  "use cache: remote";
  keepRendererBuildIdInCacheKey(rendererBuildId);
  setCacheScope({
    tags: [
      CACHE_TAGS.cmsEntry({ collectionSlug, slug }),
    ],
    ttl: "8 hours",
  });

  // Fetch the locale-specific row so the table of contents matches the body
  // content; without this the TOC always falls back to the default-locale entry.
  const entry = await getCmsEntryBySlug({
    collectionSlug,
    includeRelations: MARKDOWN_FRAME_RELATIONS,
    slug,
    locale,
    status: CMS_ENTRY_STATUS.PUBLISHED,
  });

  if (!entry) {
    return null;
  }

  return buildDocsEntryArtifacts({
    entry,
    sourceUrl: absoluteLocalizedUrl({
      pathname: sourcePathname,
      locale: isLocale(entry.locale) ? entry.locale : DEFAULT_LOCALE,
    }),
  });
}
