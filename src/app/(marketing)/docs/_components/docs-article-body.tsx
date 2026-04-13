import type { JSONContent } from "@tiptap/core";

import { CmsEntryBody } from "@/components/cms-entry-body";
import type { TableOfContentsItem } from "@/lib/cms/table-of-contents-tree";

interface DocsArticleBodyProps {
  content: JSONContent;
  tableOfContents: TableOfContentsItem[];
}

export function DocsArticleBody({
  content,
  tableOfContents,
}: DocsArticleBodyProps) {
  return (
    <CmsEntryBody
      content={content}
      className="prose prose-neutral max-w-none dark:prose-invert"
      tableOfContents={tableOfContents}
    />
  );
}
