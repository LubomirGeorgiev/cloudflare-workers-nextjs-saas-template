import "server-only";

import { eq, inArray } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { revalidatePath } from "next/cache";
import { type CmsNavigationKey } from "@/../cms.config";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getDB } from "@/db";
import {
  cmsNavigationItemTable,
  cmsNavigationRedirectTable,
  type CmsNavigationItem,
  type CmsNavigationRedirect,
} from "@/db/schema";
import {
  getCmsCollection,
  type CmsCollectionListItem,
} from "@/lib/cms/entry";
import {
  buildCmsResolvedPath,
  normalizeCmsResolvedPath,
} from "@/lib/cms/cms-paths";
import { getCmsNavigationConfig } from "@/lib/cms/cms-navigation-config";
import { invalidateCmsSearchCache, isCollectionSearchEnabled } from "@/lib/cms/cms-search";
import { generateSlug } from "@/utils/slugify";
import { CACHE_TAGS, revalidateCacheTag, setCacheScope } from "@/utils/cache";
import { CMS_STATUS_FILTER_ALL, type CmsStatusFilter } from "@/types/cms";
import {
  CMS_NAVIGATION_NODE_TYPES,
  type CmsNavigationNodeType,
} from "@/types/cms-navigation";
import { DEFAULT_LOCALE, ENABLED_LOCALES, type Locale } from "@/i18n/config";

interface GetCmsNavigationTreeParams {
  navigationKey: CmsNavigationKey;
  status?: CmsStatusFilter;
  // Locale whose entry rows populate `node.entry`. Defaults to DEFAULT_LOCALE so
  // existing callers (admin nav editor, sitemap, llms.txt) resolve the English entry
  // unchanged; the docs render path passes the active locale for the translated row.
  locale?: Locale;
}

export interface CmsNavigationTreeNode extends CmsNavigationItem {
  entry: CmsCollectionListItem | null;
  children: CmsNavigationTreeNode[];
}

export interface CmsNavigationFlatNode {
  id: string;
  parentId: string | null;
  nodeType: CmsNavigationNodeType;
  title: string;
  // Per-locale `title` overrides (non-default locales only); null/empty = untranslated.
  titleTranslations?: Partial<Record<Locale, string>> | null;
  entryId: string | null;
  slugSegment: string | null;
  sortOrder: number;
}

interface SaveCmsNavigationTreeParams {
  navigationKey: CmsNavigationKey;
  items: CmsNavigationFlatNode[];
}

interface PathComputationResult {
  resolvedPath: string | null;
  normalizedSlugSegment: string | null;
}

function getNavigationCollectionSlug(navigationKey: CmsNavigationKey) {
  return getCmsNavigationConfig(navigationKey).collectionSlug;
}

async function invalidateCmsNavigationCaches(navigationKey: CmsNavigationKey): Promise<void> {
  await Promise.all([
    revalidateCacheTag(CACHE_TAGS.cmsNavigation(navigationKey)),
    revalidateCacheTag(CACHE_TAGS.cmsRedirect(navigationKey)),
    revalidateCacheTag(CACHE_TAGS.SITEMAP),
  ]);

  if (isCollectionSearchEnabled(getNavigationCollectionSlug(navigationKey))) {
    await invalidateCmsSearchCache(getNavigationCollectionSlug(navigationKey));
  }
}

function revalidateCmsNavigationPaths(paths: Iterable<string | null | undefined>): void {
  for (const path of new Set(Array.from(paths).filter((value): value is string => Boolean(value)))) {
    for (const locale of ENABLED_LOCALES) {
      revalidatePath(locale === DEFAULT_LOCALE ? path : `/${locale}${path}`);
    }
  }
}

// Keeps only non-empty, trimmed overrides for served non-default locales (the default locale always uses
// `title`), collapsing an empty map to null. Iterating ENABLED_LOCALES drops overrides for locales that
// aren't served (e.g. every non-default locale once i18n is disabled).
function sanitizeTitleTranslations(
  raw: Partial<Record<Locale, string>> | null | undefined,
): Partial<Record<Locale, string>> | null {
  if (!raw) {
    return null;
  }

  const cleaned: Partial<Record<Locale, string>> = {};
  for (const locale of ENABLED_LOCALES) {
    if (locale === DEFAULT_LOCALE) {
      continue;
    }
    const value = raw[locale]?.trim();
    if (value) {
      cleaned[locale] = value;
    }
  }

  return Object.keys(cleaned).length > 0 ? cleaned : null;
}

function normalizeSlugSegment(slugSegment: string | null | undefined): string | null {
  if (!slugSegment) {
    return null;
  }

  const normalized = generateSlug(slugSegment);
  return normalized || null;
}

function computeNodePath({
  node,
  ancestorSegments,
  navigationKey,
}: {
  node: CmsNavigationFlatNode;
  ancestorSegments: string[];
  navigationKey: CmsNavigationKey;
}): PathComputationResult {
  const navigationConfig = getCmsNavigationConfig(navigationKey);
  const normalizedSlugSegment = normalizeSlugSegment(node.slugSegment);

  if (node.nodeType === CMS_NAVIGATION_NODE_TYPES.GROUP) {
    const resolvedPath = normalizedSlugSegment
      ? buildCmsResolvedPath({
          basePath: navigationConfig.basePath,
          segments: [...ancestorSegments, normalizedSlugSegment],
        })
      : null;

    return {
      normalizedSlugSegment,
      resolvedPath,
    };
  }

  if (!normalizedSlugSegment) {
    throw new Error(`Page node "${node.title}" must have a slug segment`);
  }

  const fullSegments = [...ancestorSegments, normalizedSlugSegment];

  return {
      normalizedSlugSegment,
      resolvedPath: buildCmsResolvedPath({
      basePath: navigationConfig.basePath,
      segments: fullSegments,
    }),
  };
}

function flattenTree(nodes: CmsNavigationTreeNode[]): CmsNavigationTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children)]);
}

function buildTree({
  items,
  entryById,
  localizedEntryByTranslationKey,
  locale = DEFAULT_LOCALE,
}: {
  items: CmsNavigationItem[];
  entryById: Map<string, CmsCollectionListItem>;
  // `entryId` is a fixed FK to the default-locale (English) row; translations are
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

      return [
        item.id,
        {
          ...item,
          title: localizedTitle,
          entry: localizedEntry,
          children: [],
        },
      ];
    })
  );

  const roots: CmsNavigationTreeNode[] = [];

  nodeMap.forEach((node) => {
    if (node.parentId) {
      const parent = nodeMap.get(node.parentId);
      if (parent) {
        parent.children.push(node);
        return;
      }
    }

    roots.push(node);
  });

  const sortNodes = (nodesToSort: CmsNavigationTreeNode[]) => {
    nodesToSort.sort((left, right) => left.sortOrder - right.sortOrder);
    nodesToSort.forEach((node) => sortNodes(node.children));
  };

  sortNodes(roots);

  return roots;
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
  return nodes.reduce<CmsNavigationTreeNode[]>((acc, node) => {
    const children = pruneNavigationTree(node.children);

    if (node.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE && !node.entry) {
      return acc.concat(children);
    }

    acc.push({
      ...node,
      children,
    });

    return acc;
  }, []);
}

function getTreeAncestorChain({
  nodeId,
  nodesById,
}: {
  nodeId: string;
  nodesById: Map<string, CmsNavigationTreeNode>;
}): CmsNavigationTreeNode[] {
  const chain: CmsNavigationTreeNode[] = [];
  let current = nodesById.get(nodeId) ?? null;

  while (current) {
    chain.unshift(current);
    current = current.parentId ? nodesById.get(current.parentId) ?? null : null;
  }

  return chain;
}

async function getCachedCmsNavigationTree(
  navigationKey: CmsNavigationKey,
  status: CmsStatusFilter,
  locale: Locale,
): Promise<CmsNavigationTreeNode[]> {
  "use cache: remote";
  setCacheScope({
    tags: [
      CACHE_TAGS.cmsNavigation(navigationKey),
    ],
    ttl: "8 hours",
  });

  const db = getDB();
  const collectionSlug = getNavigationCollectionSlug(navigationKey);
  const isNonDefaultLocale = locale !== DEFAULT_LOCALE;

  // `entryId` is a fixed FK to the default-locale anchor row (see `buildTree`), so
  // the anchor set always maps entryId -> (collection, slug); non-default locales
  // additionally fetch that locale's rows to resolve the actual translation.
  const [items, anchorEntries, localizedEntries] = await Promise.all([
    db.query.cmsNavigationItemTable.findMany({
      where: { navigationKey: navigationKey },
      orderBy: { sortOrder: "asc", createdAt: "asc" },
    }),
    getCmsCollection({
      collectionSlug,
      status,
      locale: DEFAULT_LOCALE,
      includeRelations: {
        createdByUser: true,
        tags: true,
      },
    }),
    isNonDefaultLocale
      ? getCmsCollection({
          collectionSlug,
          status,
          locale,
          includeRelations: {
            createdByUser: true,
            tags: true,
          },
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

  return pruneNavigationTree(hydratedTree);
}

export function getCmsNavigationTree({
  navigationKey,
  status = CMS_ENTRY_STATUS.PUBLISHED,
  locale = DEFAULT_LOCALE,
}: GetCmsNavigationTreeParams): Promise<CmsNavigationTreeNode[]> {
  return getCachedCmsNavigationTree(navigationKey, status, locale);
}

export async function getCmsNavigationRedirectByPath({
  navigationKey,
  path,
}: {
  navigationKey: CmsNavigationKey;
  path: string;
}): Promise<CmsNavigationRedirect | null> {
  const normalizedPath = normalizeCmsResolvedPath(path);

  return getCachedCmsNavigationRedirectByPath(navigationKey, normalizedPath);
}

async function getCachedCmsNavigationRedirectByPath(
  navigationKey: CmsNavigationKey,
  normalizedPath: string,
): Promise<CmsNavigationRedirect | null> {
  "use cache: remote";
  setCacheScope({
    tags: [
      CACHE_TAGS.cmsRedirect(navigationKey),
    ],
    ttl: "8 hours",
  });

  const db = getDB();
  return (await db.query.cmsNavigationRedirectTable.findFirst({
    where: {
      navigationKey,
      fromPath: normalizedPath,
    },
  })) ?? null;
}

export async function getCmsNavigationRootPath({
  navigationKey,
}: {
  navigationKey: CmsNavigationKey;
}): Promise<string | null> {
  const tree = await getCmsNavigationTree({
    navigationKey,
    status: CMS_ENTRY_STATUS.PUBLISHED,
  });

  const flatNodes = flattenTree(tree);
  return (
    flatNodes.find((node) => node.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE)?.resolvedPath ?? null
  );
}

export function getCmsNavigationNodeByResolvedPath({
  path,
  nodes,
}: {
  path: string;
  nodes: CmsNavigationTreeNode[];
}): CmsNavigationTreeNode | null {
  const normalizedPath = normalizeCmsResolvedPath(path);
  return flattenTree(nodes).find((node) => node.resolvedPath === normalizedPath) ?? null;
}

// Navigation attaches to the default-locale anchor row's `entryId`, but every locale sibling shares the
// anchor's `(collection, slug)`. Resolving by the hydrated `node.entry.slug` therefore treats a translation
// as in-navigation whenever its anchor is, instead of missing because the translation row has a different id.
export function getCmsNavigationNodeByEntrySlug({
  slug,
  nodes,
}: {
  slug: string;
  nodes: CmsNavigationTreeNode[];
}): CmsNavigationTreeNode | null {
  return flattenTree(nodes).find((node) => node.entry?.slug === slug) ?? null;
}

export function getCmsNavigationAncestors({
  nodeId,
  nodes,
}: {
  nodeId: string;
  nodes: CmsNavigationTreeNode[];
}): CmsNavigationTreeNode[] {
  const nodesById = new Map(flattenTree(nodes).map((node) => [node.id, node]));
  const chain = getTreeAncestorChain({
    nodeId,
    nodesById,
  });

  return chain.slice(0, -1);
}

export function getCmsNavigationPrevNext({
  currentNodeId,
  nodes,
}: {
  currentNodeId: string;
  nodes: CmsNavigationTreeNode[];
}): {
  previous: CmsNavigationTreeNode | null;
  next: CmsNavigationTreeNode | null;
} {
  const pageNodes = flattenTree(nodes).filter(
    (node) => node.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE && node.entry
  );
  const currentIndex = pageNodes.findIndex((node) => node.id === currentNodeId);

  return {
    previous: currentIndex > 0 ? pageNodes[currentIndex - 1] : null,
    next:
      currentIndex >= 0 && currentIndex < pageNodes.length - 1
        ? pageNodes[currentIndex + 1]
        : null,
  };
}

function remapTemporaryIds(items: CmsNavigationFlatNode[]): CmsNavigationFlatNode[] {
  const idMap = new Map<string, string>();

  items.forEach((item) => {
    if (item.id.startsWith("temp_")) {
      idMap.set(item.id, `cms_nav_${createId()}`);
    }
  });

  return items.map((item) => ({
    ...item,
    id: idMap.get(item.id) ?? item.id,
    parentId: item.parentId ? idMap.get(item.parentId) ?? item.parentId : null,
  }));
}

function assertValidNavigationTree(items: CmsNavigationFlatNode[]) {
  const nodeIds = new Set(items.map((item) => item.id));
  const seenEntryIds = new Set<string>();

  items.forEach((item) => {
    if (item.parentId && !nodeIds.has(item.parentId)) {
      throw new Error(`Navigation item "${item.title}" references a missing parent`);
    }

    if (item.parentId === item.id) {
      throw new Error(`Navigation item "${item.title}" cannot be its own parent`);
    }

    if (item.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE && !item.entryId) {
      throw new Error(`Page node "${item.title}" must be attached to a docs entry`);
    }

    if (item.entryId) {
      if (seenEntryIds.has(item.entryId)) {
        throw new Error("Each docs entry can only be attached to the navigation once");
      }

      seenEntryIds.add(item.entryId);
    }
  });

  items.forEach((item) => {
    const visited = new Set<string>([item.id]);
    let currentParentId = item.parentId;

    while (currentParentId) {
      if (visited.has(currentParentId)) {
        throw new Error(`Navigation item "${item.title}" would create a cycle`);
      }

      visited.add(currentParentId);
      currentParentId = items.find((candidate) => candidate.id === currentParentId)?.parentId ?? null;
    }
  });
}

function computeNavigationPaths({
  items,
  navigationKey,
}: {
  items: CmsNavigationFlatNode[];
  navigationKey: CmsNavigationKey;
}) {
  const childrenByParent = new Map<string | null, CmsNavigationFlatNode[]>();

  items.forEach((item) => {
    const siblings = childrenByParent.get(item.parentId) ?? [];
    siblings.push(item);
    childrenByParent.set(item.parentId, siblings);
  });

  childrenByParent.forEach((siblings) => {
    siblings.sort((left, right) => left.sortOrder - right.sortOrder);
  });

  const pathById = new Map<string, string | null>();
  const normalizedSlugById = new Map<string, string | null>();
  const usedPaths = new Map<string, string>();

  const visit = (parentId: string | null, ancestorSegments: string[]) => {
    const siblings = childrenByParent.get(parentId) ?? [];

    siblings.forEach((item, index) => {
      item.sortOrder = index;

      const { normalizedSlugSegment, resolvedPath } = computeNodePath({
        node: item,
        ancestorSegments,
        navigationKey,
      });
      normalizedSlugById.set(item.id, normalizedSlugSegment);
      pathById.set(item.id, resolvedPath);

      if (resolvedPath) {
        const collisionKey = resolvedPath.toLowerCase();
        const conflictingTitle = usedPaths.get(collisionKey);

        if (conflictingTitle) {
          throw new Error(`Navigation path collision detected between "${conflictingTitle}" and "${item.title}" at "${resolvedPath}"`);
        }

        usedPaths.set(collisionKey, item.title);
      }

      const nextSegments =
        normalizedSlugSegment && item.nodeType === CMS_NAVIGATION_NODE_TYPES.GROUP
          ? [...ancestorSegments, normalizedSlugSegment]
          : item.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE && normalizedSlugSegment
            ? [...ancestorSegments, normalizedSlugSegment]
            : ancestorSegments;

      visit(item.id, nextSegments);
    });
  };

  visit(null, []);

  return {
    normalizedSlugById,
    pathById,
  };
}

export async function saveCmsNavigationTree({
  navigationKey,
  items,
}: SaveCmsNavigationTreeParams): Promise<CmsNavigationTreeNode[]> {
  const db = getDB();
  const remappedItems = remapTemporaryIds(items).map((item) => ({
    ...item,
    title: item.title.trim(),
    titleTranslations: sanitizeTitleTranslations(item.titleTranslations),
    entryId: item.entryId ?? null,
    slugSegment: item.slugSegment?.trim() ? item.slugSegment.trim() : null,
  }));

  assertValidNavigationTree(remappedItems);

  const entryIds = remappedItems
    .map((item) => item.entryId)
    .filter((entryId): entryId is string => Boolean(entryId));

  const linkedEntries = entryIds.length > 0
    ? await db.query.cmsEntryTable.findMany({
        where: {
          id: { in: entryIds },
          collection: getNavigationCollectionSlug(navigationKey),
        },
      })
    : [];

  const linkedEntryIds = new Set(linkedEntries.map((entry) => entry.id));
  remappedItems.forEach((item) => {
    if (item.entryId && !linkedEntryIds.has(item.entryId)) {
      throw new Error(`Navigation item "${item.title}" references a missing CMS entry`);
    }
  });

  const { normalizedSlugById, pathById } = computeNavigationPaths({
    items: remappedItems,
    navigationKey,
  });
  const existingItems = await db.query.cmsNavigationItemTable.findMany({
    where: { navigationKey: navigationKey },
  });
  const existingPaths = new Map(existingItems.map((item) => [item.id, item.resolvedPath]));
  const submittedIds = new Set(remappedItems.map((item) => item.id));

  const itemsById = new Map(remappedItems.map((item) => [item.id, item]));
  const orderedItems = [...remappedItems].sort((left, right) => {
    const leftDepth = getNodeDepth({ nodeId: left.id, itemsById });
    const rightDepth = getNodeDepth({ nodeId: right.id, itemsById });

    if (leftDepth !== rightDepth) {
      return leftDepth - rightDepth;
    }

    return left.sortOrder - right.sortOrder;
  });

  for (const item of orderedItems) {
    const values = {
      navigationKey,
      parentId: item.parentId,
      nodeType: item.nodeType,
      title: item.title,
      titleTranslations: item.titleTranslations,
      entryId: item.entryId,
      slugSegment: normalizedSlugById.get(item.id) ?? null,
      resolvedPath: pathById.get(item.id) ?? null,
      sortOrder: item.sortOrder,
    };

    if (existingPaths.has(item.id)) {
      await db.update(cmsNavigationItemTable).set(values).where(eq(cmsNavigationItemTable.id, item.id));
    } else {
      await db.insert(cmsNavigationItemTable).values({
        id: item.id,
        ...values,
      });
    }
  }

  const removedIds = existingItems
    .map((item) => item.id)
    .filter((id) => !submittedIds.has(id));

  if (removedIds.length > 0) {
    await db.delete(cmsNavigationItemTable).where(inArray(cmsNavigationItemTable.id, removedIds));
  }

  for (const item of remappedItems) {
    const oldPath = existingPaths.get(item.id);
    const newPath = pathById.get(item.id);

    if (oldPath && newPath && oldPath !== newPath) {
      await db
        .insert(cmsNavigationRedirectTable)
        .values({
          navigationKey,
          fromPath: oldPath,
          toPath: newPath,
          statusCode: 307,
        })
        .onConflictDoUpdate({
          target: [
            cmsNavigationRedirectTable.navigationKey,
            cmsNavigationRedirectTable.fromPath,
          ],
          set: {
            toPath: newPath,
            statusCode: 307,
            updatedAt: new Date(),
          },
        });
    }
  }

  await invalidateCmsNavigationCaches(navigationKey);
  revalidateCmsNavigationPaths([
    ...existingPaths.values(),
    ...pathById.values(),
  ]);

  return getCmsNavigationTree({
    navigationKey,
    status: CMS_STATUS_FILTER_ALL,
  });
}

function getNodeDepth({
  nodeId,
  itemsById,
}: {
  nodeId: string;
  itemsById: Map<string, CmsNavigationFlatNode>;
}): number {
  let depth = 0;
  let current = itemsById.get(nodeId) ?? null;

  while (current?.parentId) {
    depth += 1;
    current = itemsById.get(current.parentId) ?? null;
  }

  return depth;
}
