import "server-only";

import { cmsConfig } from "@/../cms.config";
import { SITE_NAME } from "@/constants";
import { buildAbsoluteCmsEntryMarkdownUrl } from "@/lib/cms/cms-paths";
import { DOCS_SLUG } from "@/lib/cms/docs-config";
import type { CmsNavigationTreeNode } from "@/lib/cms/cms-navigation-repository";
import { CMS_NAVIGATION_NODE_TYPES } from "@/types/cms-navigation";

function escapeMarkdownLinkText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function collectDocPagesInNavOrder(
  nodes: CmsNavigationTreeNode[]
): CmsNavigationTreeNode[] {
  return nodes.flatMap((node) => {
    const page =
      node.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE && node.entry ? [node] : [];
    return [...page, ...collectDocPagesInNavOrder(node.children)];
  });
}

function singleLineDescription(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function pageDescription(node: CmsNavigationTreeNode): string {
  if (!node.entry) {
    return node.title;
  }

  const fromSeo = node.entry.seoDescription?.trim();
  if (fromSeo) {
    return singleLineDescription(fromSeo);
  }

  return singleLineDescription(node.entry.title);
}

export function buildDocsLlmsTxtContent(nodes: CmsNavigationTreeNode[]): string {
  const pages = collectDocPagesInNavOrder(nodes);
  const docsIntro =
    cmsConfig.collections[DOCS_SLUG].description?.trim() ||
    "Product documentation for this application: how it works, how to run and deploy it, and how to use its features.";

  const lines: string[] = [
    `# ${SITE_NAME}`,
    "",
    singleLineDescription(docsIntro),
    "",
    "## Documentation",
    "",
  ];

  for (const node of pages) {
    if (!node.entry) {
      continue;
    }

    const url = buildAbsoluteCmsEntryMarkdownUrl({
      collectionSlug: node.entry.collection,
      slug: node.entry.slug,
    });
    const title = escapeMarkdownLinkText(node.title);
    const desc = pageDescription(node);
    lines.push(`- [${title}](${url}): ${desc}`);
  }

  lines.push("");
  return lines.join("\n");
}
