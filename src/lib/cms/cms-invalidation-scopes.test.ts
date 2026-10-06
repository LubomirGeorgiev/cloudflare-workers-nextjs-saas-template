import { describe, expect, test } from "vitest";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { BLOG_COLLECTION_SLUG } from "@/lib/blog-routing";
import { DOCS_SLUG } from "@/lib/cms/docs-config";
import { CMS_NAVIGATION_NODE_TYPES } from "@/types/cms-navigation";

import {
  getPublishStateChange,
  mayHeaderLinkFlip,
  PUBLISH_STATE_CHANGES,
  selectEntryWriteItemChange,
  selectNavigationPageChange,
} from "./cms-invalidation-scopes";

const { PUBLISHED, UNPUBLISHED } = PUBLISH_STATE_CHANGES;

function page(entryId: string) {
  return { nodeType: CMS_NAVIGATION_NODE_TYPES.PAGE, entryId };
}

function group(entryId: string | null = null) {
  return { nodeType: CMS_NAVIGATION_NODE_TYPES.GROUP, entryId };
}

function added(addedItems: number) {
  return { addedItems, removedItems: 0 };
}

function removed(removedItems: number) {
  return { addedItems: 0, removedItems };
}

describe("getPublishStateChange", () => {
  test("names the direction of a move into or out of the published state", () => {
    expect(getPublishStateChange({ statusBefore: CMS_ENTRY_STATUS.DRAFT, statusAfter: CMS_ENTRY_STATUS.PUBLISHED }))
      .toBe(PUBLISHED);
    expect(getPublishStateChange({ statusBefore: CMS_ENTRY_STATUS.PUBLISHED, statusAfter: CMS_ENTRY_STATUS.ARCHIVED }))
      .toBe(UNPUBLISHED);
  });

  // A create has no row before it, and a delete has no row after it.
  test("a created or deleted published row is a change, and a draft one is not", () => {
    expect(getPublishStateChange({ statusBefore: null, statusAfter: CMS_ENTRY_STATUS.PUBLISHED })).toBe(PUBLISHED);
    expect(getPublishStateChange({ statusBefore: CMS_ENTRY_STATUS.PUBLISHED, statusAfter: null })).toBe(UNPUBLISHED);
    expect(getPublishStateChange({ statusBefore: null, statusAfter: CMS_ENTRY_STATUS.DRAFT })).toBeNull();
    expect(getPublishStateChange({ statusBefore: CMS_ENTRY_STATUS.DRAFT, statusAfter: null })).toBeNull();
  });

  test("a content edit, or a move between two unpublished states, is not a change", () => {
    expect(getPublishStateChange({ statusBefore: CMS_ENTRY_STATUS.PUBLISHED, statusAfter: CMS_ENTRY_STATUS.PUBLISHED }))
      .toBeNull();
    expect(getPublishStateChange({ statusBefore: CMS_ENTRY_STATUS.DRAFT, statusAfter: CMS_ENTRY_STATUS.SCHEDULED }))
      .toBeNull();
  });
});

describe("selectEntryWriteItemChange", () => {
  const entries = [
    { collection: BLOG_COLLECTION_SLUG, slug: "first" },
    { collection: BLOG_COLLECTION_SLUG, slug: "first" },
    { collection: BLOG_COLLECTION_SLUG, slug: "second" },
    { collection: DOCS_SLUG, slug: "first" },
  ];

  test("counts distinct slugs of one collection on the side of the change", () => {
    expect(selectEntryWriteItemChange({ entries, collection: BLOG_COLLECTION_SLUG, publishStateChange: PUBLISHED }))
      .toEqual(added(2));
    expect(selectEntryWriteItemChange({ entries, collection: DOCS_SLUG, publishStateChange: UNPUBLISHED }))
      .toEqual(removed(1));
  });
});

describe("selectNavigationPageChange", () => {
  test("a reorder or a rename keeps the page set, so nothing changed", () => {
    expect(selectNavigationPageChange({
      itemsBefore: [page("a"), group(), page("b")],
      itemsAfter: [page("b"), page("a"), group()],
    })).toEqual(added(0));
  });

  test("counts the pages that the save added and removed", () => {
    expect(selectNavigationPageChange({ itemsBefore: [], itemsAfter: [page("a")] })).toEqual(added(1));
    expect(selectNavigationPageChange({ itemsBefore: [page("a"), page("b")], itemsAfter: [page("b"), page("c")] }))
      .toEqual({ addedItems: 1, removedItems: 1 });
  });

  // The header looks only at page nodes, so a group with an entry is not a page.
  test("ignores groups, even a group with an entry", () => {
    expect(selectNavigationPageChange({ itemsBefore: [group("a")], itemsAfter: [] })).toEqual(added(0));
  });
});

describe("mayHeaderLinkFlip", () => {
  test("a write that changed no item never flips the link", () => {
    expect(mayHeaderLinkFlip({ change: added(0), liveItemsAfter: 0 })).toBe(false);
    expect(mayHeaderLinkFlip({ change: added(0), liveItemsAfter: null })).toBe(false);
  });

  // The first publish: before the write no item was live.
  test("the first live item may flip the link", () => {
    expect(mayHeaderLinkFlip({ change: added(1), liveItemsAfter: 1 })).toBe(true);
  });

  // The last unpublish, archive, or delete: after the write no item is live.
  test("a removal that leaves no live item may flip the link", () => {
    expect(mayHeaderLinkFlip({ change: removed(1), liveItemsAfter: 0 })).toBe(true);
  });

  test("an item outside the write was live before and after, so the link stays", () => {
    expect(mayHeaderLinkFlip({ change: added(1), liveItemsAfter: 2 })).toBe(false);
    expect(mayHeaderLinkFlip({ change: added(3), liveItemsAfter: 4 })).toBe(false);
    expect(mayHeaderLinkFlip({ change: removed(1), liveItemsAfter: 1 })).toBe(false);
  });

  // For example, a docs entry that goes live before a navigation page links it.
  test("an addition that leaves no live item cannot flip the link", () => {
    expect(mayHeaderLinkFlip({ change: added(1), liveItemsAfter: 0 })).toBe(false);
  });

  test("a save that adds and removes pages flips only when the live set may change sides", () => {
    const swap = { addedItems: 1, removedItems: 1 };

    expect(mayHeaderLinkFlip({ change: swap, liveItemsAfter: 0 })).toBe(true);
    expect(mayHeaderLinkFlip({ change: swap, liveItemsAfter: 1 })).toBe(true);
    expect(mayHeaderLinkFlip({ change: swap, liveItemsAfter: 2 })).toBe(false);
  });

  test("an unknown count purges, because a missed flip is the worse error", () => {
    expect(mayHeaderLinkFlip({ change: added(1), liveItemsAfter: null })).toBe(true);
    expect(mayHeaderLinkFlip({ change: removed(1), liveItemsAfter: null })).toBe(true);
  });
});
