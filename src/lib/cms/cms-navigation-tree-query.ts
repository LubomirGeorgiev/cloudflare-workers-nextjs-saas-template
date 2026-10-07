import "server-only";

import { type CmsNavigationKey } from "@/../cms.config";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getDB } from "@/db";
import { type CmsNavigationItem } from "@/db/schema";
// Straight from `queries`, never the `@/lib/cms/entry` barrel: the barrel also pulls in `mutations`,
// which reaches `cms-cache-invalidation.ts`, and that module imports this one.
import { getCmsCollection, getFreshCmsCollection } from "@/lib/cms/entry/queries";
import type { CmsCollectionListItem } from "@/lib/cms/entry/types";
import { buildCmsResolvedPath } from "@/lib/cms/cms-paths";
import { isSafeIconMarkup } from "@/lib/cms/cms-icon-rules";
import { getCmsNavigationConfig } from "@/lib/cms/cms-navigation-config";
import { assembleNavigationTree } from "@/lib/cms/cms-navigation-tree";
import { type CmsStatusFilter } from "@/types/cms";
import {
  CMS_NAVIGATION_NODE_TYPES,
  type CmsIconBody,
  type CmsIconBodyByKey,
} from "@/types/cms-navigation";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { generateSlug } from "@/utils/slugify";

// `iconBody` is deliberately absent: a tree crosses to the client whole, and one copy of the SVG
// per row is the same payload mistake `CmsCollectionListItem` drops `content` to avoid. The bodies
// travel beside the tree, deduped by key — see `getCmsNavigationIconBodies`.
export interface CmsNavigationTreeNode extends Omit<CmsNavigationItem, "iconBody"> {
  entry: CmsCollectionListItem | null;
  children: CmsNavigationTreeNode[];
}

/** What one cached read of a navigation tree holds: the nodes, and the icon markup they name. */
export interface CmsNavigationTreeResult {
  nodes: CmsNavigationTreeNode[];
  iconBodyByKey: CmsIconBodyByKey;
}

export function getNavigationCollectionSlug(navigationKey: CmsNavigationKey) {
  return getCmsNavigationConfig(navigationKey).collectionSlug;
}

export function normalizeSlugSegment(slugSegment: string | null | undefined): string | null {
  if (!slugSegment) {
    return null;
  }

  const normalized = generateSlug(slugSegment);
  return normalized || null;
}

// The one depth-first walk over a navigation tree — exported so callers outside this module
// (sitemap, llms.txt) filter a flat list instead of hand-rolling a second traversal.
export function flattenCmsNavigationTree(
  nodes: CmsNavigationTreeNode[],
): CmsNavigationTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenCmsNavigationTree(node.children)]);
}

function buildTree({
  items,
  entryById,
  localizedEntryByTranslationKey,
  locale = DEFAULT_LOCALE,
}: {
  items: CmsNavigationItem[];
  entryById: Map<string, CmsCollectionListItem>;
  // `entryId` is a fixed FK to the default-locale row; translations are
  // separate rows sharing (collection, slug) with a different `id`. This optional
  // `${collection}::${slug}`-keyed map supplies the locale row for `node.entry`.
  localizedEntryByTranslationKey?: Map<string, CmsCollectionListItem>;
  // Overlays `titleTranslations[locale]` onto GROUP/header titles for non-default
  // locales. PAGE nodes still borrow the linked entry's translated title via
  // getNavigationNodeDisplayTitle, so this only fills nodes with no linked entry.
  locale?: Locale;
}): CmsNavigationTreeNode[] {
  const nodeMap = new Map<string, CmsNavigationTreeNode>(
    items.map((item) => {
      const anchorEntry = item.entryId ? entryById.get(item.entryId) ?? null : null;
      const localizedEntry = anchorEntry && localizedEntryByTranslationKey
        ? localizedEntryByTranslationKey.get(`${anchorEntry.collection}::${anchorEntry.slug}`) ?? null
        : anchorEntry;

      const localizedTitle = locale !== DEFAULT_LOCALE
        ? item.titleTranslations?.[locale] ?? item.title
        : item.title;

      const { iconBody: __iconBody, ...node } = item;

      return [
        item.id,
        {
          ...node,
          title: localizedTitle,
          entry: localizedEntry,
          children: [],
        },
      ];
    })
  );

  return assembleNavigationTree(nodeMap);
}

function hydrateMissingResolvedPaths({
  nodes,
  navigationKey,
  ancestorSegments = [],
}: {
  nodes: CmsNavigationTreeNode[];
  navigationKey: CmsNavigationKey;
  ancestorSegments?: string[];
}): CmsNavigationTreeNode[] {
  const navigationConfig = getCmsNavigationConfig(navigationKey);

  return nodes.map((node) => {
    const normalizedSlugSegment = normalizeSlugSegment(node.slugSegment);
    const nextSegments = normalizedSlugSegment
      ? [...ancestorSegments, normalizedSlugSegment]
      : ancestorSegments;
    const resolvedPath = node.resolvedPath ?? (
      normalizedSlugSegment
        ? buildCmsResolvedPath({
            basePath: navigationConfig.basePath,
            segments: nextSegments,
          })
        : null
    );

    return {
      ...node,
      resolvedPath,
      children: hydrateMissingResolvedPaths({
        nodes: node.children,
        navigationKey,
        ancestorSegments: nextSegments,
      }),
    };
  });
}

function pruneNavigationTree(nodes: CmsNavigationTreeNode[]): CmsNavigationTreeNode[] {
  return nodes.flatMap((node) => {
    const children = pruneNavigationTree(node.children);

    if (node.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE && !node.entry) {
      return children;
    }

    return [{ ...node, children }];
  });
}

/**
 * One entry per icon key, from the unpruned rows, so every locale gets the same full map. Sanitize
 * again on the way out: the save-time rule may have tightened. The `typeof` guard drops a row of an
 * older shape with no `markup`; that row loses its icon, but every page of the navigation renders.
 */
function collectIconBodies(items: CmsNavigationItem[]): CmsIconBodyByKey {
  const iconBodyByKey: Record<string, CmsIconBody> = {};

  for (const item of items) {
    const markup = item.iconBody?.markup;

    if (item.icon && typeof markup === "string" && !iconBodyByKey[item.icon] && isSafeIconMarkup(markup)) {
      iconBodyByKey[item.icon] = item.iconBody as CmsIconBody;
    }
  }

  return iconBodyByKey;
}

/**
 * The number of live pages in a navigation, straight from D1. The invalidation pipeline asks it
 * just after a write, when the cached tree can still hold the state before the write.
 */
export async function getFreshCmsNavigationLivePageCount({
  navigationKey,
}: {
  navigationKey: CmsNavigationKey;
}): Promise<number> {
  const { nodes } = await getFreshCmsNavigationTree({
    navigationKey,
    status: CMS_ENTRY_STATUS.PUBLISHED,
  });

  // The tree is pruned to live entries, so every page node in it is live.
  return flattenCmsNavigationTree(nodes)
    .filter((node) => node.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE)
    .length;
}

/**
 * A navigation tree straight from D1, for admin screens and the invalidation pipeline. The cached
 * tree and its collection read can still serve the state before a write for about 2 minutes.
 */
export function getFreshCmsNavigationTree({
  navigationKey,
  status,
}: {
  navigationKey: CmsNavigationKey;
  status: CmsStatusFilter;
}): Promise<CmsNavigationTreeResult> {
  return queryCmsNavigationTree({
    navigationKey,
    status,
    locale: DEFAULT_LOCALE,
    readCollection: getFreshCmsCollection,
  });
}

// One build for the cached tree and the fresh tree, so both apply the same live rule.
export async function queryCmsNavigationTree({
  navigationKey,
  status,
  locale,
  readCollection,
}: {
  navigationKey: CmsNavigationKey;
  status: CmsStatusFilter;
  locale: Locale;
  readCollection: typeof getCmsCollection;
}): Promise<CmsNavigationTreeResult> {
  // Not the replica client: the first read after a save refills the cache, and a replica that still
  // lags the save would cache the old tree.
  const db = getDB();
  const collectionSlug = getNavigationCollectionSlug(navigationKey);
  const isNonDefaultLocale = locale !== DEFAULT_LOCALE;

  // `entryId` is a fixed FK to the default-locale anchor row (see `buildTree`); a non-default locale
  // also reads its own rows. No author relation: no tree reader renders one, and the author purge
  // (`cms-author-cache-invalidation.ts`) skips a user with no published entry.
  const [items, anchorEntries, localizedEntries] = await Promise.all([
    db.query.cmsNavigationItemTable.findMany({
      where: { navigationKey: navigationKey },
      orderBy: { sortOrder: "asc", createdAt: "asc" },
    }),
    readCollection({
      collectionSlug,
      status,
      locale: DEFAULT_LOCALE,
      includeRelations: { tags: true },
    }),
    isNonDefaultLocale
      ? readCollection({
          collectionSlug,
          status,
          locale,
          includeRelations: { tags: true },
        })
      : Promise.resolve<CmsCollectionListItem[]>([]),
  ]);

  const tree = buildTree({
    items,
    entryById: new Map(anchorEntries.map((entry) => [entry.id, entry])),
    localizedEntryByTranslationKey: isNonDefaultLocale
      ? new Map(localizedEntries.map((entry) => [`${entry.collection}::${entry.slug}`, entry]))
      : undefined,
    locale,
  });
  const hydratedTree = hydrateMissingResolvedPaths({
    nodes: tree,
    navigationKey,
  });

  return {
    nodes: pruneNavigationTree(hydratedTree),
    iconBodyByKey: collectIconBodies(items),
  };
}
