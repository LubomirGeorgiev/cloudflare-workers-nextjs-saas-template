import "server-only";

import { cmsConfig } from "@/../cms.config";
import { API_CATALOG_PATH, API_OPENAPI_SPEC_PATH, SITE_NAME, SITE_URL } from "@/constants";
import { getMcpEndpointUrl } from "@/constants/agent-clients";
import { INDEXED_DOCS_ROUTES, type DocsPageRoute } from "@/constants/docs-routes";
import { BLOG_LISTING_ROUTES, STATIC_PUBLIC_ROUTES } from "@/constants/public-routes";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { getTranslator, type TranslatorNamespace } from "@/i18n/translator";
import { DOCS_SEARCH_API_PATH, DOCS_SLUG } from "@/lib/cms/docs-config";
import type { CmsCollectionListItem } from "@/lib/cms/entry";
import type { CmsNavigationTreeNode } from "@/lib/cms/cms-navigation-repository";
import { singleLine } from "@/lib/markdown-pages/markdown-document";
import { buildAbsoluteMarkdownPageUrl } from "@/lib/markdown-pages/page-paths";
import { CMS_NAVIGATION_NODE_TYPES, type CmsNavigationNodeType } from "@/types/cms-navigation";
import { getBlogFacetPageCounts } from "@/lib/cms/blog-facet-pages";
import { getBlogCollectionPagePath } from "@/lib/blog-routing";
import { getAuthorDisplayName, getAuthorRouteParam } from "@/utils/blog-author-url";
import { RATE_LIMITS } from "@/utils/with-rate-limit";

interface DocsRouteCopy {
  summary: string;
  title: string;
}

interface RouteWithMetaNamespace {
  metaNamespace: TranslatorNamespace;
  pathname: string;
}

/** Docs routes index by id, every other route list by pathname, so the key is a caller decision. */
type RouteCopyKeyOf<TRoute> = (route: TRoute) => string;

function routePathnameKey(route: RouteWithMetaNamespace): string {
  return route.pathname;
}

function docsRouteIdKey(route: DocsPageRoute): string {
  return route.id;
}

async function loadRouteCopy(metaNamespace: TranslatorNamespace): Promise<DocsRouteCopy> {
  const t = await getTranslator({
    locale: DEFAULT_LOCALE,
    namespace: metaNamespace,
  });

  return {
    title: t("title"),
    summary: singleLine(t("description")),
  };
}

async function loadRouteCopyMap<TRoute extends RouteWithMetaNamespace>({
  keyOf,
  routes,
}: {
  keyOf: RouteCopyKeyOf<TRoute>;
  routes: ReadonlyArray<TRoute>;
}): Promise<Map<string, DocsRouteCopy>> {
  const entries = await Promise.all(
    routes.map(async (route) => {
      return [keyOf(route), await loadRouteCopy(route.metaNamespace)] as const;
    }),
  );

  return new Map(entries);
}

function escapeMarkdownLinkText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

/**
 * A route the copy map does not cover would drop out of llms.txt unnoticed, so this fails the
 * build instead. Exported only so the co-located test can reach the mismatch directly.
 */
export function requireRouteCopy({
  key,
  routeCopy,
}: {
  key: string;
  routeCopy: Map<string, DocsRouteCopy>;
}): DocsRouteCopy {
  const copy = routeCopy.get(key);

  if (!copy) {
    throw new Error(`llms.txt is missing metadata copy for route "${key}"`);
  }

  return copy;
}

function appendRouteCopyLines<TRoute extends RouteWithMetaNamespace>({
  keyOf,
  lines,
  routeCopy,
  routes,
}: {
  keyOf: RouteCopyKeyOf<TRoute>;
  lines: string[];
  routeCopy: Map<string, DocsRouteCopy>;
  routes: ReadonlyArray<TRoute>;
}): void {
  for (const route of routes) {
    const copy = requireRouteCopy({ key: keyOf(route), routeCopy });

    lines.push(
      `- [${escapeMarkdownLinkText(copy.title)}](${buildAbsoluteMarkdownPageUrl({ pathname: route.pathname })}): ${copy.summary}`,
    );
  }
}

function pageDescription({
  node,
  fallback,
}: {
  node: CmsNavigationTreeNode;
  fallback: (title: string) => string;
}): string {
  if (!node.entry) {
    return singleLine(fallback(node.title));
  }

  const fromSeo = node.entry.seoDescription?.trim();
  return singleLine(fromSeo || fallback(node.entry.title));
}

function blogDescription(entry: CmsCollectionListItem): string {
  const seoDescription = entry.seoDescription?.trim();
  return singleLine(seoDescription || entry.title);
}

function appendNodeLines({
  lines,
  nodes,
  pageDescriptionFallback,
  depth = 0,
}: {
  lines: string[];
  nodes: CmsNavigationTreeNode[];
  pageDescriptionFallback: (title: string) => string;
  depth?: number;
}) {
  let lastRenderedType: CmsNavigationNodeType | null = null;

  for (const node of nodes) {
    if (node.nodeType === CMS_NAVIGATION_NODE_TYPES.GROUP) {
      const headingLevel = Math.min(depth + 3, 6);

      if (lastRenderedType !== null) {
        lines.push("");
      }

      lines.push(`${"#".repeat(headingLevel)} ${node.title}`);
      appendNodeLines({
        lines,
        nodes: node.children,
        pageDescriptionFallback,
        depth: depth + 1,
      });
      lastRenderedType = CMS_NAVIGATION_NODE_TYPES.GROUP;
      continue;
    }

    if (!node.entry || !node.resolvedPath) {
      continue;
    }

    const url = buildAbsoluteMarkdownPageUrl({ pathname: node.resolvedPath });
    // The entry title is the page metadata title. The navigation title can be a shorter label.
    const title = escapeMarkdownLinkText(node.entry.title);
    const desc = pageDescription({ node, fallback: pageDescriptionFallback });

    // A root page after a group would join that group's bullet list without this break.
    if (depth === 0 && lastRenderedType === CMS_NAVIGATION_NODE_TYPES.GROUP) {
      lines.push("");
    }

    lines.push(`- [${title}](${url}): ${desc}`);
    lastRenderedType = CMS_NAVIGATION_NODE_TYPES.PAGE;
  }
}

function appendBlogFacetLines({ lines, basePath, totalPages, title, description }: {
  lines: string[];
  basePath: string;
  totalPages: number;
  title: string;
  description: string;
}) {
  for (let page = 1; page <= totalPages; page++) {
    const pathname = getBlogCollectionPagePath({ pathname: basePath, page });
    const label = page === 1 ? title : `${title} (${page})`;
    lines.push(`- [${escapeMarkdownLinkText(label)}](${buildAbsoluteMarkdownPageUrl({ pathname })}): ${singleLine(description)}`);
  }
}

async function appendBlogLines({
  blogEntries,
  lines,
  routeCopy,
}: {
  blogEntries: CmsCollectionListItem[];
  lines: string[];
  routeCopy: Map<string, DocsRouteCopy>;
}): Promise<void> {
  if (blogEntries.length === 0) {
    return;
  }

  const [tTag, tAuthor, tAuthorDetail] = await Promise.all([
    getTranslator({ locale: DEFAULT_LOCALE, namespace: "Blog.TagDetail.meta" }),
    getTranslator({ locale: DEFAULT_LOCALE, namespace: "Blog.AuthorDetail.meta" }),
    getTranslator({ locale: DEFAULT_LOCALE, namespace: "Blog.AuthorDetail" }),
  ]);
  const pageCounts = getBlogFacetPageCounts(blogEntries);
  const tags = new Map<string, NonNullable<CmsCollectionListItem["tags"]>[number]["tag"]>();
  const authors = new Map<string, NonNullable<CmsCollectionListItem["createdByUser"]>>();

  lines.push("## Blog", "");

  appendRouteCopyLines({
    keyOf: routePathnameKey,
    lines,
    routeCopy,
    routes: BLOG_LISTING_ROUTES,
  });

  lines.push("", "### Articles");
  for (const entry of blogEntries) {
    const description = blogDescription(entry);
    const line = `- [${escapeMarkdownLinkText(entry.title)}](${buildAbsoluteMarkdownPageUrl({ pathname: `/blog/${entry.slug}` })})`;
    lines.push(`${line}: ${description}`);

    entry.tags?.forEach(({ tag }) => tags.set(tag.slug, tag));
    if (entry.createdByUser) {
      authors.set(entry.createdByUser.id, entry.createdByUser);
    }
  }

  if (tags.size > 0) {
    lines.push("", "### Topics");
    for (const tag of tags.values()) {
      const title = tTag("title", { name: tag.name });
      const description = tag.description?.trim() || tTag("description", { name: tag.name });
      const basePath = `/blog/tags/${tag.slug}`;
      appendBlogFacetLines({ lines, basePath, totalPages: pageCounts.get(basePath) ?? 1, title, description });
    }
  }

  if (authors.size > 0) {
    lines.push("", "### Authors");
    for (const author of authors.values()) {
      const name = getAuthorDisplayName(author, tAuthorDetail("unknownAuthor"));
      const title = tAuthor("title", { name });
      const description = tAuthor("description", { name });
      const basePath = `/blog/authors/${getAuthorRouteParam(author)}`;
      appendBlogFacetLines({ lines, basePath, totalPages: pageCounts.get(basePath) ?? 1, title, description });
    }
  }

  lines.push("");
}

function appendSearchApiLines(lines: string[]): void {
  const exampleUrl = `${SITE_URL}${DOCS_SEARCH_API_PATH}?q=authentication&limit=8`;

  lines.push(
    "## Search API",
    "",
    `- [Documentation search API](${exampleUrl}): Find relevant docs. The \`q\` parameter is required. \`limit\` defaults to 8 and accepts 1-20. The JSON response returns matching page metadata and excerpts.`,
    "",
  );
}

function appendStaticPageLines({
  lines,
  routeCopy,
}: {
  lines: string[];
  routeCopy: Map<string, DocsRouteCopy>;
}): void {
  lines.push("## Site pages", "");

  appendRouteCopyLines({
    keyOf: routePathnameKey,
    lines,
    routeCopy,
    routes: STATIC_PUBLIC_ROUTES,
  });

  lines.push("");
}

function appendMachineInterfaceLines({
  lines,
  routeCopy,
}: {
  lines: string[];
  routeCopy: Map<string, DocsRouteCopy>;
}): void {
  lines.push("## API and MCP", "");

  appendRouteCopyLines({
    keyOf: docsRouteIdKey,
    lines,
    routeCopy,
    routes: INDEXED_DOCS_ROUTES,
  });

  lines.push(
    `- [API catalog](${SITE_URL}${API_CATALOG_PATH}): RFC 9727 linkset with the REST API, the MCP endpoint, and where each one is described.`,
    `- [OpenAPI document](${SITE_URL}${API_OPENAPI_SPEC_PATH}): Exact OpenAPI 3.1 contract with operations, scopes, schemas, and errors.`,
    `- [MCP endpoint](${getMcpEndpointUrl()}): Streamable HTTP endpoint for the same operations as agent tools. Use an API key or OAuth.`,
    "",
    `Authenticated REST requests and MCP calls share a limit of ${RATE_LIMITS.API_AUTHED.limit} requests per ${RATE_LIMITS.API_AUTHED.windowInSeconds} seconds per credential. Responses include \`RateLimit-Limit\`, \`RateLimit-Remaining\`, and \`RateLimit-Reset\`. A 429 response also includes \`retry-after\`.`,
    "",
  );
}

export async function buildLlmsTxtContent({
  blogEntries,
  docsNodes,
}: {
  blogEntries: CmsCollectionListItem[];
  docsNodes: CmsNavigationTreeNode[];
}): Promise<string> {
  const docsIntro = cmsConfig.collections[DOCS_SLUG].description?.trim();
  const [blogRouteCopy, docsRouteCopy, staticRouteCopy, tDocsMeta] = await Promise.all([
    loadRouteCopyMap({ keyOf: routePathnameKey, routes: BLOG_LISTING_ROUTES }),
    loadRouteCopyMap({ keyOf: docsRouteIdKey, routes: INDEXED_DOCS_ROUTES }),
    loadRouteCopyMap({ keyOf: routePathnameKey, routes: STATIC_PUBLIC_ROUTES }),
    getTranslator({
      locale: DEFAULT_LOCALE,
      namespace: "Client.Docs.meta",
    }),
  ]);
  const siteSummary = staticRouteCopy.get("/")?.summary;
  const lines: string[] = [`# ${SITE_NAME}`, ""];

  if (siteSummary) {
    lines.push(siteSummary, "");
  }

  appendStaticPageLines({ lines, routeCopy: staticRouteCopy });
  lines.push("## Documentation", "");
  if (docsIntro) {
    lines.push(singleLine(docsIntro), "");
  }
  appendNodeLines({
    lines,
    nodes: docsNodes,
    pageDescriptionFallback: (title) => tDocsMeta("pageDescription", { title }),
  });
  lines.push("");
  appendSearchApiLines(lines);
  appendMachineInterfaceLines({ lines, routeCopy: docsRouteCopy });
  await appendBlogLines({ blogEntries, lines, routeCopy: blogRouteCopy });

  lines.push("");
  return lines.join("\n");
}
