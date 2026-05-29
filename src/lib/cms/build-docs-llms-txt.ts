import "server-only";

import { cmsConfig } from "@/../cms.config";
import { SITE_NAME, SITE_URL } from "@/constants";
import { buildAbsoluteCmsEntryMarkdownUrl } from "@/lib/cms/cms-paths";
import { DOCS_SEARCH_API_PATH, DOCS_SLUG } from "@/lib/cms/docs-config";
import type { CmsNavigationTreeNode } from "@/lib/cms/cms-navigation-repository";
import { CMS_NAVIGATION_NODE_TYPES } from "@/types/cms-navigation";

function escapeMarkdownLinkText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function singleLineDescription(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function pageDescription(node: CmsNavigationTreeNode): string | null {
  if (!node.entry) {
    return null;
  }

  const fromSeo = node.entry.seoDescription?.trim();
  if (fromSeo) {
    return singleLineDescription(fromSeo);
  }

  return null;
}

function appendNodeLines({
  lines,
  nodes,
  depth = 0,
}: {
  lines: string[];
  nodes: CmsNavigationTreeNode[];
  depth?: number;
}) {
  let hasRenderedNode = false;

  for (const node of nodes) {
    if (node.nodeType === CMS_NAVIGATION_NODE_TYPES.GROUP) {
      const headingLevel = Math.min(depth + 3, 6);

      if (hasRenderedNode) {
        lines.push("");
      }

      lines.push(`${"#".repeat(headingLevel)} ${node.title}`);
      appendNodeLines({
        lines,
        nodes: node.children,
        depth: depth + 1,
      });
      hasRenderedNode = true;
      continue;
    }

    if (!node.entry) {
      continue;
    }

    const url = buildAbsoluteCmsEntryMarkdownUrl({
      collectionSlug: node.entry.collection,
      slug: node.entry.slug,
    });
    const title = escapeMarkdownLinkText(node.title);
    const desc = pageDescription(node);

    if (depth === 0) {
      if (hasRenderedNode) {
        lines.push("");
      }

      lines.push(
        desc
          ? `### [${title}](${url}): ${desc}`
          : `### [${title}](${url})`
      );
      hasRenderedNode = true;
      continue;
    }

    lines.push(desc ? `- [${title}](${url}): ${desc}` : `- [${title}](${url})`);
    hasRenderedNode = true;
  }
}

function appendSearchApiLines(lines: string[]): void {
  const exampleUrl = `${SITE_URL}${DOCS_SEARCH_API_PATH}?q=authentication&limit=8`;

  lines.push(
    "## Search API",
    "",
    `AI agents can find relevant docs with \`GET ${exampleUrl}\`. The \`q\` parameter is required, \`limit\` defaults to 8 and accepts 1-20, and the JSON response returns a \`results\` array with \`title\`, \`resolvedPath\`, \`snippet\`, \`slug\`, \`seoDescription\`, and \`entryId\`.`,
    ""
  );
}

export function buildDocsLlmsTxtContent(nodes: CmsNavigationTreeNode[]): string {
  const docsIntro = cmsConfig.collections[DOCS_SLUG].description?.trim();

  const lines: string[] = [
    `# ${SITE_NAME}`,
    "",
    "## Documentation",
    "",
  ];

  if (docsIntro) {
    lines.splice(2, 0, singleLineDescription(docsIntro), "");
  }

  appendSearchApiLines(lines);
  appendNodeLines({
    lines,
    nodes,
  });

  lines.push("");
  return lines.join("\n");
}
