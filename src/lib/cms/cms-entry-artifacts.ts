import "server-only";

import type { JSONContent } from "@tiptap/core";

import { extractTableOfContents } from "@/lib/cms/extract-table-of-contents";
import {
  buildTableOfContentsTree,
  type TableOfContentsItem,
  type TableOfContentsNode,
} from "@/lib/cms/table-of-contents-tree";

export interface CmsHtmlArtifacts {
  html: string;
  tableOfContents: TableOfContentsItem[];
  tableOfContentsTree: TableOfContentsNode[];
}

// The renderer stays behind a dynamic import so the TipTap static renderer never
// reaches a hot path that does not render an entry body.
export async function buildCmsHtmlArtifacts({ content }: {
  content: JSONContent;
}): Promise<CmsHtmlArtifacts> {
  const tableOfContents = extractTableOfContents(content);
  const { renderCmsContentToHtml } = await import("@/lib/cms/render-cms-html");

  return {
    html: renderCmsContentToHtml({ content }),
    tableOfContents,
    tableOfContentsTree: buildTableOfContentsTree(tableOfContents),
  };
}

// "use cache" keys on arguments, so a cached loader must take the renderer build id
// and keep it read. A new renderer must not serve markup an old one produced.
export function keepRendererBuildIdInCacheKey(rendererBuildId: string): void {
  void rendererBuildId;
}
