import { getTranslator } from "@/i18n/translator";

import type { Locale } from "@/i18n/config";

import { ContentTableOfContentsNav } from "@/components/content-table-of-contents-nav";
import type { TableOfContentsNode } from "@/lib/cms/table-of-contents-tree";

interface DocsOnThisPageNavProps {
  nodes: TableOfContentsNode[];
  locale: Locale;
}

export async function DocsOnThisPageNav({ nodes, locale }: DocsOnThisPageNavProps) {
  const t = await getTranslator({ locale, namespace: "Client.Docs.Page" });

  return (
    <ContentTableOfContentsNav nodes={nodes} ariaLabel={t("onThisPage")} scrollArea />
  );
}
