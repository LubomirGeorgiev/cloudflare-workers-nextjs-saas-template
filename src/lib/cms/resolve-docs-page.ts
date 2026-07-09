import "server-only";

import type { CollectionsUnion } from "@/../cms.config";
import { buildCmsResolvedPath } from "@/lib/cms/cms-paths";
import type { CmsNavigationTreeNode } from "@/lib/cms/cms-navigation-repository";
import { CMS_NAVIGATION_NODE_TYPES } from "@/types/cms-navigation";
import type { Locale } from "@/i18n/config";

interface CmsNavigationRedirectResult {
  toPath: string;
  statusCode: number;
}

type ResolveDocsPageResult =
  | { type: "redirect"; path: string; permanent: boolean }
  | { type: "markdown-redirect"; collectionSlug: CollectionsUnion; slug: string }
  | { type: "not-found" }
  | { type: "group"; node: CmsNavigationTreeNode; navigationTree: CmsNavigationTreeNode[] }
  | {
      type: "page";
      node: CmsNavigationTreeNode;
      navigationTree: CmsNavigationTreeNode[];
      // True when the doc has no translation for the active `locale`, so `node`
      // came from the default-locale tree. Callers render it under the active
      // prefix (no redirect) — the unprefixed URL infinite-loops under `localeDetection`.
      isFallback: boolean;
    };

interface ResolveDocsPageParams {
  slugParts: string[] | undefined;
  locale: Locale;
  defaultLocale: Locale;
  docsBasePath: string;
  getNavigationTree: (params: { locale: Locale }) => Promise<CmsNavigationTreeNode[]>;
  getNavigationRedirectByPath: (params: { path: string }) => Promise<CmsNavigationRedirectResult | null>;
  getNavigationRootPath: () => Promise<string | null>;
  // Injected (rather than imported from cms-navigation-repository directly) so
  // this module stays free of that file's top-level `getDB`/drizzle import —
  // keeps `resolveDocsPage` unit-testable outside the Workers runtime.
  getNodeByResolvedPath: (params: {
    path: string;
    nodes: CmsNavigationTreeNode[];
  }) => CmsNavigationTreeNode | null;
}

function stripMdSuffixFromSlugParts(slugParts: string[]): string[] | undefined {
  const last = slugParts[slugParts.length - 1]!;
  if (!last.toLowerCase().endsWith(".md")) {
    return undefined;
  }

  const base = last.slice(0, -".md".length);
  if (!base) {
    return undefined;
  }

  return [...slugParts.slice(0, -1), base];
}

// `path` on every "redirect" result below is locale-agnostic (e.g. "/docs/foo").
// Callers must resolve it through `@/i18n/navigation`'s localized redirects so the
// active locale prefix is preserved rather than dropped.
export async function resolveDocsPage({
  slugParts,
  locale,
  defaultLocale,
  docsBasePath,
  getNavigationTree,
  getNavigationRedirectByPath,
  getNavigationRootPath,
  getNodeByResolvedPath,
}: ResolveDocsPageParams): Promise<ResolveDocsPageResult> {
  if (!slugParts || slugParts.length === 0) {
    const rootPath = await getNavigationRootPath();

    return {
      type: "redirect",
      path: rootPath ?? "/",
      permanent: false,
    };
  }

  const mdStrippedSegments = stripMdSuffixFromSlugParts(slugParts);
  const segmentsForResolve = mdStrippedSegments ?? slugParts;
  const isMarkdownSuffixRequest = mdStrippedSegments !== undefined;

  const navigationTree = await getNavigationTree({ locale });

  if (navigationTree.length === 0) {
    return {
      type: "redirect",
      path: "/",
      permanent: false,
    };
  }

  const resolvedPath = buildCmsResolvedPath({
    basePath: docsBasePath,
    segments: segmentsForResolve,
  });
  const node = getNodeByResolvedPath({
    path: resolvedPath,
    nodes: navigationTree,
  });

  if (!node) {
    // An untranslated page node is pruned from the locale-scoped tree above, so it
    // looks "not found" even though it exists in the default locale. Re-check the
    // default-locale tree before giving up, so untranslated docs fall back instead of 404.
    if (locale !== defaultLocale) {
      const defaultLocaleTree = await getNavigationTree({ locale: defaultLocale });
      const defaultLocaleNode = getNodeByResolvedPath({
        path: resolvedPath,
        nodes: defaultLocaleTree,
      });

      if (defaultLocaleNode?.entry) {
        if (isMarkdownSuffixRequest) {
          return {
            type: "markdown-redirect",
            collectionSlug: defaultLocaleNode.entry.collection,
            slug: defaultLocaleNode.entry.slug,
          };
        }

        return {
          type: "page",
          node: defaultLocaleNode,
          navigationTree: defaultLocaleTree,
          isFallback: true,
        };
      }
    }

    const routeRedirect = await getNavigationRedirectByPath({ path: resolvedPath });

    if (routeRedirect) {
      return {
        type: "redirect",
        path: routeRedirect.toPath,
        permanent: routeRedirect.statusCode === 301,
      };
    }

    return {
      type: "not-found",
    };
  }

  if (node.nodeType === CMS_NAVIGATION_NODE_TYPES.GROUP) {
    return {
      type: "group",
      node,
      navigationTree,
    };
  }

  if (!node.entry) {
    return {
      type: "not-found",
    };
  }

  if (isMarkdownSuffixRequest) {
    return {
      type: "markdown-redirect",
      collectionSlug: node.entry.collection,
      slug: node.entry.slug,
    };
  }

  return {
    type: "page",
    node,
    navigationTree,
    isFallback: false,
  };
}
