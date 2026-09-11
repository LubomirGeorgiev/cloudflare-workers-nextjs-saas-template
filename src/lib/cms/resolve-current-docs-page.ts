import "server-only"

import { createNavigationMemo } from "@/lib/cms/navigation-memos"
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

// A docs page and its `opengraph-image` ask for one slug each, so a handful of hot pages fit.
const CURRENT_DOCS_PAGE_MEMO_ENTRIES = 32;

interface CurrentDocsPageParams {
  slugParts: string[] | undefined;
  locale: Locale;
}

// Wires the pure `resolveDocsPage` resolver to the CMS navigation repository. Kept out of the
// resolver module so that one stays free of the repository's top-level `getDB`/drizzle import, and
// out of the page so the docs page and its `opengraph-image` resolve a slug the exact same way.
async function loadCurrentDocsPage({ slugParts, locale }: CurrentDocsPageParams) {
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

// The second-hottest cached read after the navigation links, and every docs page pays it. The memo
// keys on the same primitives the cache key does; a URL segment can never hold a "/", so joining
// the slug parts cannot collide. Declared after the cached body, which the transform makes a const.
const currentDocsPageMemo = createNavigationMemo({
  build: loadCurrentDocsPage,
  keyOf: ({ slugParts, locale }: CurrentDocsPageParams) => `${locale}|${slugParts?.join("/") ?? ""}`,
  maxEntries: CURRENT_DOCS_PAGE_MEMO_ENTRIES,
});

export function resolveCurrentDocsPage(params: CurrentDocsPageParams) {
  return currentDocsPageMemo.read(params);
}


function toNavigationLink(node: CmsNavigationTreeNode) {
  return {
    id: node.id,
    title: getNavigationNodeDisplayTitle(node),
    resolvedPath: node.resolvedPath,
    description: node.entry?.seoDescription || null,
    // The prev/next cards draw the same icon ladder as the sidebar, so they carry the node's icon
    // key; the page looks its markup up in the tree's shared body map.
    nodeType: node.nodeType,
    icon: node.icon ?? null,
    iconColor: node.iconColor ?? null,
  };
}
