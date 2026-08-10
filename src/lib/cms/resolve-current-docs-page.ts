import "server-only"

import { DEFAULT_LOCALE, type Locale } from "@/i18n/config"

import { getCmsNavigationConfig } from "./cms-navigation-config"
import {
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
export async function resolveCurrentDocsPage(slugParts: string[] | undefined, locale: Locale) {
  const docsNavigation = getCmsNavigationConfig(DOCS_SLUG)

  return resolveDocsPage({
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
}
