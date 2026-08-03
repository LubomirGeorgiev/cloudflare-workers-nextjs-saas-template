import "server-only";

import { cmsConfig } from "@/../cms.config";
import { API_OPENAPI_SPEC_PATH, SITE_NAME, SITE_URL } from "@/constants";
import { getMcpEndpointUrl } from "@/constants/agent-clients";
import { INDEXED_DOCS_ROUTES, type DocsRouteId } from "@/constants/docs-routes";
import { buildAbsoluteCmsEntryMarkdownUrl } from "@/lib/cms/cms-paths";
import { DOCS_SEARCH_API_PATH, DOCS_SLUG } from "@/lib/cms/docs-config";
import type { CmsNavigationTreeNode } from "@/lib/cms/cms-navigation-repository";
import { CMS_NAVIGATION_NODE_TYPES } from "@/types/cms-navigation";
import { RATE_LIMITS } from "@/utils/with-rate-limit";

// How each docs route is announced to an agent. Written for a reader of llms.txt rather than
// reusing the sidebar label, and untranslated: llms.txt is one default-locale machine surface.
//
// Total over every route id, so a new docs route has to decide here rather than silently vanishing
// from llms.txt. `null` = deliberately not announced, for machine endpoints like llms.txt itself.
const DOCS_ROUTE_LLMS_TXT_COPY: Record<DocsRouteId, { title: string; summary: string } | null> = {
  llmsTxt: null,
  // Already announced with its own bullet in `appendMachineInterfaceLines`.
  openApiDocument: null,
  apiReference: {
    title: "API reference",
    summary: "browsable reference rendered from the OpenAPI document.",
  },
  apiErrors: {
    title: "API error codes",
    summary:
      "every stable error `code` with its HTTP status; problem responses' `type` member links here, anchored at the code.",
  },
  authGuide: {
    title: "Authentication",
    summary: "API keys, OAuth 2.1, scopes, and revocation.",
  },
  mcpGuide: {
    title: "Connecting AI agents (MCP)",
    summary: "per-client setup for agent clients.",
  },
};

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

// The two machine surfaces an agent can act on, not just read: the spec it can generate a client
// from, and the MCP endpoint it can connect to directly. Both are single non-localized URLs.
function appendMachineInterfaceLines(lines: string[]): void {
  lines.push(
    "## API and MCP",
    "",
    `- OpenAPI 3.1 document: \`GET ${SITE_URL}${API_OPENAPI_SPEC_PATH}\` — every public REST operation with its scopes, request and response schemas, and error shape.`,
    `- MCP endpoint (Streamable HTTP): \`${getMcpEndpointUrl()}\` — the same operations as agent tools. Authenticate with an API key as a bearer token, or connect over OAuth.`,
    `- Authenticated REST requests and MCP tool calls share a limit of ${RATE_LIMITS.API_AUTHED.limit} requests per ${RATE_LIMITS.API_AUTHED.windowInSeconds} seconds per credential. Every response carries \`RateLimit-Limit\`, \`RateLimit-Remaining\`, and \`RateLimit-Reset\` (seconds until the window resets); a 429 also includes \`retry-after\`.`
  );

  for (const route of INDEXED_DOCS_ROUTES) {
    const copy = DOCS_ROUTE_LLMS_TXT_COPY[route.id];

    if (copy) {
      lines.push(`- [${copy.title}](${SITE_URL}${route.pathname}): ${copy.summary}`);
    }
  }

  lines.push("");
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
  appendMachineInterfaceLines(lines);
  appendNodeLines({
    lines,
    nodes,
  });

  lines.push("");
  return lines.join("\n");
}
