import "server-only";

import type { JSONContent } from "@tiptap/core";

import { SITE_NAME } from "@/constants";
import type { GetCmsCollectionResult } from "@/lib/cms/cms-repository";
import { renderContentToMarkdown } from "@/lib/cms/render-content-to-markdown";

// oxlint-disable-next-line project/no-unused-module-exports -- CMS modules intentionally expose helpers for admin/tooling extensions.
export function buildCmsEntryMarkdownResponse(entry: GetCmsCollectionResult): Response {
  const markdown = renderContentToMarkdown(entry.content as JSONContent);
  const fileName = `${SITE_NAME.toLowerCase().replace(/\s+/g, "-")}-${entry.collection}-${entry.slug}.md`;

  return new Response(markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${fileName}"`,
    },
  });
}
