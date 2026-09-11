import "server-only";

import { cache } from "react";
import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { type CmsNavigationKey } from "@/../cms.config";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getDB, getReadReplicaDB } from "@/db";
import {
  cmsNavigationItemTable,
  cmsNavigationRedirectTable,
  type CmsNavigationItem,
  type CmsNavigationRedirect,
} from "@/db/schema";
// Straight from `queries`, never the `@/lib/cms/entry` barrel: the barrel also pulls in
// `mutations`, which reaches the invalidation path that clears this module's memo.
import { getCmsCollection } from "@/lib/cms/entry/queries";
import type { CmsCollectionListItem } from "@/lib/cms/entry/types";
import {
  buildCmsResolvedPath,
  normalizeCmsResolvedPath,
} from "@/lib/cms/cms-paths";
import {
  isSafeIconMarkup,
  parseUploadedSvgIcon,
  resolveNavigationIconBodies,
} from "@/lib/cms/cms-icon-rules";
import { requireIconBodies } from "@/lib/cms/cms-icons";
import { getCmsNavigationConfig } from "@/lib/cms/cms-navigation-config";
import { purgeDocsNavigationMarkdownPages } from "@/lib/cms/cms-navigation-page-purge";
import { assembleNavigationTree } from "@/lib/cms/cms-navigation-tree";
import { invalidateCmsSearchCache, isCollectionSearchEnabled } from "@/lib/cms/cms-search";
import {
  clearNavigationMemos,
  createNavigationMemo,
} from "@/lib/cms/navigation-memos";
import { generateSlug } from "@/utils/slugify";
import { CACHE_TAGS, revalidateCacheTag, setCacheScope } from "@/utils/cache";
import { CMS_STATUS_FILTER_ALL, type CmsStatusFilter } from "@/types/cms";
import {
  CMS_NAVIGATION_NODE_TYPES,
  type CmsIconBody,
  type CmsIconBodyByKey,
  type CmsNavigationNodeType,
} from "@/types/cms-navigation";
import { DEFAULT_LOCALE, ENABLED_LOCALES, type Locale } from "@/i18n/config";
import { createRandomId } from "@/utils/random-token";

// One published tree per navigation key and locale, plus the admin status filters.
const CMS_NAVIGATION_TREE_MEMO_ENTRIES = 16;

interface GetCmsNavigationTreeParams {
  navigationKey: CmsNavigationKey;
  status?: CmsStatusFilter;
  // Locale whose entry rows populate `node.entry`. Defaults to DEFAULT_LOCALE so
  // existing callers (admin nav editor, sitemap, llms.txt) resolve the English entry
  // unchanged; the docs render path passes the active locale for the translated row.
  locale?: Locale;
}

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

export interface CmsNavigationFlatNode {
  id: string;
  parentId: string | null;
  nodeType: CmsNavigationNodeType;
  title: string;
  // Per-locale `title` overrides (non-default locales only); null/empty = untranslated.
  titleTranslations?: Partial<Record<Locale, string>> | null;
  // Icon key only. The body is fetched or parsed and pinned server-side, so a client cannot write
  // markup.
  icon?: string | null;
  // CSS colour for the icon; null keeps `currentColor`. Plain data, so no lookup is needed.
  iconColor?: string | null;
  entryId: string | null;
  slugSegment: string | null;
  sortOrder: number;
}

/**
 * What a client sends to save a tree: the row fields, plus the uploaded document behind a `custom:`
 * key. `iconSvg` is transport, not a column — it stops here, so no stored-row reader sees a field
 * the table does not hold. See `iconSvg` in `cms-navigation.schema.ts` for when a client sends it.
 */
export interface CmsNavigationSaveNode extends CmsNavigationFlatNode {
  iconSvg?: string | null;
}

interface SaveCmsNavigationTreeParams {
  navigationKey: CmsNavigationKey;
  items: CmsNavigationSaveNode[];
}

interface PathComputationResult {
  resolvedPath: string | null;
  normalizedSlugSegment: string | null;
}

function getNavigationCollectionSlug(navigationKey: CmsNavigationKey) {
  return getCmsNavigationConfig(navigationKey).collectionSlug;
}

async function invalidateCmsNavigationCaches(navigationKey: CmsNavigationKey): Promise<void> {
  // Before the tag revalidation, so the refill `saveCmsNavigationTree` runs next reads the new tree.
  // Every navigation memo, not just the tree: the docs page and the header memoize derived results,
  // which a fresh tree alone does not refresh.
  clearNavigationMemos();

  await Promise.all([
    revalidateCacheTag(CACHE_TAGS.cmsNavigation(navigationKey)),
    revalidateCacheTag(CACHE_TAGS.cmsRedirect(navigationKey)),
    revalidateCacheTag(CACHE_TAGS.SITEMAP),
  ]);

  await purgeDocsNavigationMarkdownPages();

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

/**
 * One entry per distinct icon key, built from the unpruned rows so every locale's entry holds the
 * same complete map. The sanitizer runs again here, on the way out: the rule that accepted a row at
 * save time may since have tightened, and nothing else revisits a stored document.
 *
 * The `typeof` guard is the same contract one step earlier. This column holds JSON we parsed, not a
 * value the type system checked, so a row written under an older shape reaches here with no
 * `markup` at all. Dropping it costs that node its icon; trusting it would throw inside the gate
 * and take down every page the navigation appears on.
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

async function getCachedCmsNavigationTree(
  navigationKey: CmsNavigationKey,
  status: CmsStatusFilter,
  locale: Locale,
): Promise<CmsNavigationTreeResult> {
  "use cache: remote";
  setCacheScope({
    tags: [
      CACHE_TAGS.cmsNavigation(navigationKey),
    ],
    ttl: "8 hours",
  });

  // Not the replica client: `saveCmsNavigationTree` invalidates this cache and then refills it in
  // the same request, so a replica that still lags the save would cache the old tree for 8 hours.
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

  return {
    nodes: pruneNavigationTree(hydratedTree),
    iconBodyByKey: collectIconBodies(items),
  };
}

// The docs tree is the largest of the hot entries, so a warm isolate keeps it in memory. The three
// arguments are the primitives the cache key uses, so the default key covers them, and the docs page
// asks for the tree from the sidebar, the slug resolver, and the header root path in one render.
// `getCmsNavigationRootPath` reads through here and needs no memo of its own.
const cmsNavigationTreeMemo = createNavigationMemo({
  build: getCachedCmsNavigationTree,
  maxEntries: CMS_NAVIGATION_TREE_MEMO_ENTRIES,
  dedupePerRequest: true,
});


export async function getCmsNavigationTree({
  navigationKey,
  status = CMS_ENTRY_STATUS.PUBLISHED,
  locale = DEFAULT_LOCALE,
}: GetCmsNavigationTreeParams): Promise<CmsNavigationTreeNode[]> {
  return (await cmsNavigationTreeMemo.read(navigationKey, status, locale)).nodes;
}

/**
 * The icon markup the same tree names, keyed by Iconify key. Reads the entry `getCmsNavigationTree`
 * reads, so asking for both on one path costs one D1 query, not two.
 */
export async function getCmsNavigationIconBodies({
  navigationKey,
  status = CMS_ENTRY_STATUS.PUBLISHED,
  locale = DEFAULT_LOCALE,
}: GetCmsNavigationTreeParams): Promise<CmsIconBodyByKey> {
  return (await cmsNavigationTreeMemo.read(navigationKey, status, locale)).iconBodyByKey;
}

export async function getCmsNavigationRedirectByPath({
  navigationKey,
  path,
}: {
  navigationKey: CmsNavigationKey;
  path: string;
}): Promise<CmsNavigationRedirect | null> {
  const normalizedPath = normalizeCmsResolvedPath(path);

  return getCachedCmsNavigationRedirectByPathOnce(navigationKey, normalizedPath);
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

  const db = getReadReplicaDB();
  return (await db.query.cmsNavigationRedirectTable.findFirst({
    where: {
      navigationKey,
      fromPath: normalizedPath,
    },
  })) ?? null;
}

// Declared after the cached function it wraps: the `"use cache"` transform rewrites that
// declaration into a `const`, so a wrapper placed above it would read it in the temporal dead zone.
const getCachedCmsNavigationRedirectByPathOnce = cache(getCachedCmsNavigationRedirectByPath);

// Walks the whole tree, so the header and the docs slug resolver share one walk per request too.
const getCachedCmsNavigationRootPath = cache(async (
  navigationKey: CmsNavigationKey,
): Promise<string | null> => {
  const tree = await getCmsNavigationTree({
    navigationKey,
    status: CMS_ENTRY_STATUS.PUBLISHED,
  });

  const flatNodes = flattenCmsNavigationTree(tree);
  return (
    flatNodes.find((node) => node.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE)?.resolvedPath ?? null
  );
});

export function getCmsNavigationRootPath({
  navigationKey,
}: {
  navigationKey: CmsNavigationKey;
}): Promise<string | null> {
  return getCachedCmsNavigationRootPath(navigationKey);
}

export function getCmsNavigationNodeByResolvedPath({
  path,
  nodes,
}: {
  path: string;
  nodes: CmsNavigationTreeNode[];
}): CmsNavigationTreeNode | null {
  const normalizedPath = normalizeCmsResolvedPath(path);
  return flattenCmsNavigationTree(nodes).find((node) => node.resolvedPath === normalizedPath) ?? null;
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
  return flattenCmsNavigationTree(nodes).find((node) => node.entry?.slug === slug) ?? null;
}

export function getCmsNavigationAncestors({
  nodeId,
  nodes,
}: {
  nodeId: string;
  nodes: CmsNavigationTreeNode[];
}): CmsNavigationTreeNode[] {
  const nodesById = new Map(flattenCmsNavigationTree(nodes).map((node) => [node.id, node]));
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
  const pageNodes = flattenCmsNavigationTree(nodes).filter(
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

function remapTemporaryIds(items: CmsNavigationSaveNode[]): CmsNavigationSaveNode[] {
  const idMap = new Map<string, string>();

  items.forEach((item) => {
    if (item.id.startsWith("temp_")) {
      idMap.set(item.id, `cms_nav_${createRandomId()}`);
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
}: SaveCmsNavigationTreeParams): Promise<CmsNavigationTreeResult> {
  const db = getDB();
  const remappedItems = remapTemporaryIds(items).map((item) => ({
    ...item,
    title: item.title.trim(),
    titleTranslations: sanitizeTitleTranslations(item.titleTranslations),
    icon: item.icon ?? null,
    iconColor: item.iconColor?.trim() || null,
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

  // Before the D1 loop on purpose: a failed icon fetch or a refused upload must leave the stored
  // tree untouched.
  const { fetchKeys, uploadedSvgByKey, existingBodyByKey } = resolveNavigationIconBodies({
    items: remappedItems,
    existingItems,
  });
  const uploadedIconBodies = new Map(
    Array.from(uploadedSvgByKey, ([key, svg]) => [key, parseUploadedSvgIcon(svg)]),
  );
  const fetchedIconBodies = fetchKeys.length > 0
    ? await requireIconBodies({ keys: fetchKeys })
    : new Map<string, CmsIconBody>();

  // Between them the three maps cover every key: `resolveNavigationIconBodies` routes each one to
  // the stored tree, to `requireIconBodies`, or to the parser, and the last two refuse a key they
  // cannot answer for. A gap here is a broken invariant, not a row to write with a key and no
  // markup.
  const resolveSavedIconBody = (key: string): CmsIconBody => {
    const body = fetchedIconBodies.get(key)
      ?? uploadedIconBodies.get(key)
      ?? existingBodyByKey.get(key);

    if (!body) {
      throw new Error(`Navigation icon "${key}" was resolved to no markup`);
    }

    return body;
  };

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
      icon: item.icon,
      iconBody: item.icon ? resolveSavedIconBody(item.icon) : null,
      iconColor: item.iconColor,
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

  return cmsNavigationTreeMemo.read(navigationKey, CMS_STATUS_FILTER_ALL, DEFAULT_LOCALE);
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
