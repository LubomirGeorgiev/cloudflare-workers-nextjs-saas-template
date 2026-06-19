import "server-only";

import type { JSONContent } from "@tiptap/core";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getCmsEntryBySlug } from "@/lib/cms/entry";
import { renderContentToMarkdown } from "@/lib/cms/render-content-to-markdown";
import { extractTableOfContents } from "@/lib/cms/extract-table-of-contents";
import { buildTableOfContentsTree } from "@/lib/cms/table-of-contents-tree";
import { CACHE_TAGS, setCacheScope } from "@/utils/cache";
import type { CollectionsUnion } from "@/../cms.config";

interface GetCachedDocsEntryArtifactsParams {
  collectionSlug: CollectionsUnion;
  slug: string;
}

export function buildDocsEntryArtifacts(content: JSONContent) {
  const tableOfContents = extractTableOfContents(content);

  return {
    markdown: renderContentToMarkdown(content),
    tableOfContents,
    tableOfContentsTree: buildTableOfContentsTree(tableOfContents),
  };
}

export async function getCachedDocsEntryArtifacts({
  collectionSlug,
  slug,
}: GetCachedDocsEntryArtifactsParams) {
  "use cache: remote";
  setCacheScope({
    tags: [
      CACHE_TAGS.CMS_ENTRY,
      CACHE_TAGS.cmsEntry({ collectionSlug, slug }),
    ],
    ttl: "8 hours",
  });

  const entry = await getCmsEntryBySlug({
    collectionSlug,
    slug,
    status: CMS_ENTRY_STATUS.PUBLISHED,
  });

  if (!entry) {
    return null;
  }

  return buildDocsEntryArtifacts(entry.content as JSONContent);
}
