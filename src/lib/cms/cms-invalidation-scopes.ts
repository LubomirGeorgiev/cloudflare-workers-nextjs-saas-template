import type { CmsNavigationKey } from "@/../cms.config";
import { CMS_ENTRY_STATUS } from "@/app/enums";
import { CACHE_TAGS } from "@/constants/cache-tags";
import { BLOG_COLLECTION_SLUG } from "@/lib/blog-routing";
import { DOCS_SLUG } from "@/lib/cms/docs-config";
import { CMS_NAVIGATION_NODE_TYPES } from "@/types/cms-navigation";

// Pure on purpose: the queue payload schema and the header read import it, and the selectors here
// are tested without mocks.

/** The fixed page groups a CMS invalidation can name beside its entries and navigation keys. */
export const CMS_INVALIDATION_SCOPES = {
  // Every CMS cache: the admin "Clear CMS cache" action.
  ALL_CMS: "all-cms",
  // Every page that renders the site header, so every stored page.
  SITE_HEADER: "site-header",
  // The tags catalog and the tag pages under it.
  TAG_CATALOG: "tag-catalog",
} as const;

export type CmsInvalidationScope =
  typeof CMS_INVALIDATION_SCOPES[keyof typeof CMS_INVALIDATION_SCOPES];

export const CMS_INVALIDATION_SCOPE_VALUES = Object.values(CMS_INVALIDATION_SCOPES) as [
  CmsInvalidationScope,
  ...CmsInvalidationScope[],
];

/** What a write changed in its entries. The repurge payload carries it with the entries. */
export const CMS_ENTRY_CHANGES = {
  // The entry itself: its content, slug, status, or place.
  CONTENT: "content",
  // Only the tags it renders, so its collection counts, navigation, and search keep their data.
  TAGS: "tags",
} as const;

export type CmsEntryChange = typeof CMS_ENTRY_CHANGES[keyof typeof CMS_ENTRY_CHANGES];

export const CMS_ENTRY_CHANGE_VALUES = Object.values(CMS_ENTRY_CHANGES) as [
  CmsEntryChange,
  ...CmsEntryChange[],
];

/** The navigation whose live pages decide if the site header shows the docs link. */
export const SITE_HEADER_NAVIGATION_KEY: CmsNavigationKey = DOCS_SLUG;

/** The tags of the one cached read behind the site header: blog presence and docs presence. */
export const SITE_HEADER_CACHE_TAGS: readonly string[] = [
  CACHE_TAGS.cmsCollectionCount(BLOG_COLLECTION_SLUG),
  CACHE_TAGS.cmsNavigation(SITE_HEADER_NAVIGATION_KEY),
];

/** The direction of a publish state change. A writer sets one only when the write moved an entry. */
export const PUBLISH_STATE_CHANGES = {
  // Into the published state: a publish, a scheduled go-live, or a published create.
  PUBLISHED: "published",
  // Out of the published state: an unpublish, an archive, or a delete of a published row.
  UNPUBLISHED: "unpublished",
} as const;

export type PublishStateChange = typeof PUBLISH_STATE_CHANGES[keyof typeof PUBLISH_STATE_CHANGES];

/** The publish state change of one row, or `null` for none. A `null` status is no row. */
export function getPublishStateChange({
  statusBefore,
  statusAfter,
}: {
  statusBefore: string | null;
  statusAfter: string | null;
}): PublishStateChange | null {
  const wasPublished = statusBefore === CMS_ENTRY_STATUS.PUBLISHED;
  const isPublished = statusAfter === CMS_ENTRY_STATUS.PUBLISHED;

  if (wasPublished === isPublished) {
    return null;
  }

  return isPublished ? PUBLISH_STATE_CHANGES.PUBLISHED : PUBLISH_STATE_CHANGES.UNPUBLISHED;
}

/** The live items that one entry write added or removed in one collection, by distinct slug. */
export function selectEntryWriteItemChange({
  entries,
  collection,
  publishStateChange,
}: {
  entries: ReadonlyArray<{ collection: string; slug: string }>;
  collection: string;
  publishStateChange: PublishStateChange;
}): HeaderItemChange {
  const writtenSlugs = new Set(
    entries.filter((entry) => entry.collection === collection).map(({ slug }) => slug),
  ).size;

  return publishStateChange === PUBLISH_STATE_CHANGES.PUBLISHED
    ? { addedItems: writtenSlugs, removedItems: 0 }
    : { addedItems: 0, removedItems: writtenSlugs };
}

/** The page entries that a navigation save added or removed. A reorder or a rename keeps them. */
export function selectNavigationPageChange({
  itemsBefore,
  itemsAfter,
}: {
  itemsBefore: ReadonlyArray<NavigationPageItem>;
  itemsAfter: ReadonlyArray<NavigationPageItem>;
}): HeaderItemChange {
  const pagesBefore = selectPageEntryIds(itemsBefore);
  const pagesAfter = selectPageEntryIds(itemsAfter);

  return {
    addedItems: pagesAfter.difference(pagesBefore).size,
    removedItems: pagesBefore.difference(pagesAfter).size,
  };
}

/** True when a write added or removed no item, so it cannot flip a header link. */
export function isEmptyHeaderItemChange({ addedItems, removedItems }: HeaderItemChange): boolean {
  return addedItems === 0 && removedItems === 0;
}

/**
 * Whether a write may flip one header link, shown while one item is live. Items outside the write
 * keep their state, so an empty set flipped only if the write removed an item, and a full set only
 * if the write added every live item. An unknown count (`null`) says yes: a missed flip is worse.
 */
export function mayHeaderLinkFlip({
  change,
  liveItemsAfter,
}: {
  change: HeaderItemChange;
  liveItemsAfter: number | null;
}): boolean {
  if (isEmptyHeaderItemChange(change)) {
    return false;
  }

  if (liveItemsAfter === null) {
    return true;
  }

  return liveItemsAfter === 0 ? change.removedItems > 0 : liveItemsAfter <= change.addedItems;
}

function selectPageEntryIds(items: ReadonlyArray<NavigationPageItem>): Set<string> {
  return new Set(items.flatMap((item) =>
    item.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE && item.entryId ? [item.entryId] : []));
}

/** The live items that one write added and removed, for one header link. */
export interface HeaderItemChange {
  addedItems: number;
  removedItems: number;
}

interface NavigationPageItem {
  nodeType: string;
  entryId: string | null;
}
