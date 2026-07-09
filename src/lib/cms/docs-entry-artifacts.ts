import "server-only";

import type { JSONContent } from "@tiptap/core";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getCmsEntryBySlug } from "@/lib/cms/entry";
import { renderContentToMarkdown } from "@/lib/cms/render-content-to-markdown";
import { extractTableOfContents } from "@/lib/cms/extract-table-of-contents";
import { buildTableOfContentsTree } from "@/lib/cms/table-of-contents-tree";
import { CACHE_TAGS, setCacheScope } from "@/utils/cache";
import type { Locale } from "@/i18n/config";
import type { CollectionsUnion } from "@/../cms.config";

interface GetCachedDocsEntryArtifactsParams {
  collectionSlug: CollectionsUnion;
  slug: string;
  locale: Locale;
}

export function buildDocsEntryArtifacts(content: JSONContent) {
  const tableOfContents = extractTableOfContents(content);

  return {
    // Return the source content too, so the page body renders from here instead of
    // the navigation tree — letting the tree drop the heavy `content` column.
    content,
    markdown: renderContentToMarkdown(content),
    tableOfContents,
    tableOfContentsTree: buildTableOfContentsTree(tableOfContents),
  };
}

export async function getCachedDocsEntryArtifacts({
  collectionSlug,
  slug,
  locale,
}: GetCachedDocsEntryArtifactsParams) {
  "use cache: remote";
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
    slug,
    locale,
    status: CMS_ENTRY_STATUS.PUBLISHED,
  });

  if (!entry) {
    return null;
  }

  return buildDocsEntryArtifacts(entry.content as JSONContent);
}
