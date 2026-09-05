import "server-only"

import { CACHE_TAGS, setCacheScope } from "@/utils/cache"
import { getNavigationNodeDisplayTitle } from "@/types/cms-navigation"
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config"

import { getCmsNavigationConfig } from "./cms-navigation-config"
import {
  getCmsNavigationAncestors,
  getCmsNavigationPrevNext,
  type CmsNavigationTreeNode,
  getCmsNavigationNodeByResolvedPath,
  getCmsNavigationRedirectByPath,
  getCmsNavigationRootPath,
  getCmsNavigationTree,
} from "./cms-navigation-repository"
import { DOCS_SLUG } from "./docs-config"
import { resolveDocsPage } from "./resolve-docs-page"

// Wires the pure `resolveDocsPage` resolver to the CMS navigation repository. Kept out of the
// resolver module so that one stays free of the repository's top-level `getDB`/drizzle import, and
// out of the page so the docs page and its `opengraph-image` resolve a slug the exact same way.
export async function resolveCurrentDocsPage({ slugParts, locale }: {
  slugParts: string[] | undefined;
  locale: Locale;
}) {
  "use cache: remote";
  setCacheScope({
    tags: [CACHE_TAGS.cmsNavigation(DOCS_SLUG), CACHE_TAGS.cmsRedirect(DOCS_SLUG)],
    ttl: "8 hours",
  });
  const docsNavigation = getCmsNavigationConfig(DOCS_SLUG)

  const result = await resolveDocsPage({
    slugParts,
    locale,
    defaultLocale: DEFAULT_LOCALE,
    docsBasePath: docsNavigation.basePath,
    getNavigationTree: ({ locale: treeLocale }) =>
      getCmsNavigationTree({ navigationKey: DOCS_SLUG, locale: treeLocale }),
    getNavigationRedirectByPath: ({ path }) =>
      getCmsNavigationRedirectByPath({ navigationKey: DOCS_SLUG, path }),
    getNavigationRootPath: () => getCmsNavigationRootPath({ navigationKey: DOCS_SLUG }),
    getNodeByResolvedPath: getCmsNavigationNodeByResolvedPath,
  })

  if (result.type === "redirect" || result.type === "not-found") {
    return result;
  }

  const { navigationTree, ...page } = result;
  const breadcrumbs = getCmsNavigationAncestors({ nodeId: page.node.id, nodes: navigationTree });
  const { previous, next } = getCmsNavigationPrevNext({ currentNodeId: page.node.id, nodes: navigationTree });
  return {
    ...page,
    breadcrumbs: breadcrumbs.map(toNavigationLink),
    previous: previous ? toNavigationLink(previous) : null,
    next: next ? toNavigationLink(next) : null,
  };
}

function toNavigationLink(node: CmsNavigationTreeNode) {
  return {
    id: node.id,
    title: getNavigationNodeDisplayTitle(node),
    resolvedPath: node.resolvedPath,
    description: node.entry?.seoDescription || null,
  };
}
