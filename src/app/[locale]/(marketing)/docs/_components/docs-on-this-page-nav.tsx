import { getTranslations } from "next-intl/server";

import { ContentTableOfContentsNav } from "@/components/content-table-of-contents-nav";
import type { TableOfContentsNode } from "@/lib/cms/table-of-contents-tree";

interface DocsOnThisPageNavProps {
  nodes: TableOfContentsNode[];
}

export async function DocsOnThisPageNav({ nodes }: DocsOnThisPageNavProps) {
  const t = await getTranslations("Client.Docs.Page");

  return (
    <ContentTableOfContentsNav nodes={nodes} ariaLabel={t("onThisPage")} scrollArea />
  );
}
