import { ContentTableOfContentsNav } from "@/components/content-table-of-contents-nav";
import type { TableOfContentsNode } from "@/lib/cms/table-of-contents-tree";

interface DocsOnThisPageNavProps {
  nodes: TableOfContentsNode[];
}

export function DocsOnThisPageNav({ nodes }: DocsOnThisPageNavProps) {
  return <ContentTableOfContentsNav nodes={nodes} />;
}
