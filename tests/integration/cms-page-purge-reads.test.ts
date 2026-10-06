/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cmsConfig, collectionSlugs, type CollectionsUnion } from "@/../cms.config";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getDB } from "@/db";
import { cmsEntryTable, cmsEntryTagTable, cmsNavigationItemTable, cmsTagTable, userTable } from "@/db/schema";
import { DEFAULT_LOCALE, ENABLED_LOCALES, LOCALES } from "@/i18n/config";
import { localizedPathname } from "@/i18n/localized-pathname";
import {
  BLOG_BASE_PATH,
  BLOG_COLLECTION_SLUG,
  getBlogAuthorPagePath,
  getBlogTagPagePath,
} from "@/lib/blog-routing";
import { getBlogListingPostCounts } from "@/lib/cms/blog-listing-post-counts";
import { getAllCmsEntryRefs } from "@/lib/cms/cms-cache-invalidation";
import { cmsEntryPagePath, purgeCmsPages } from "@/lib/cms/cms-entry-page-purge";
import { getCmsCollectionNavigationKey, getCmsNavigationConfig } from "@/lib/cms/cms-navigation-config";
import { CMS_INVALIDATION_SCOPES, SITE_HEADER_NAVIGATION_KEY } from "@/lib/cms/cms-invalidation-scopes";
import { getCmsNavigationPagePaths } from "@/lib/cms/cms-navigation-entry-paths";
import { getFreshCmsNavigationLivePageCount } from "@/lib/cms/cms-navigation-tree-query";
import { DOCS_SLUG } from "@/lib/cms/docs-config";
import { CMS_NAVIGATION_NODE_TYPES } from "@/types/cms-navigation";

const db = getDB();
const NAVIGATION_KEY = getCmsCollectionNavigationKey(DOCS_SLUG);
const NON_DEFAULT_LOCALE = LOCALES.find((locale) => locale !== DEFAULT_LOCALE);
const AUTHOR = { id: "usr_purge_reads", firstName: "Ada", lastName: "Lovelace" };
const TAG_SLUG = "purge-reads-tag";
// The Vite `define` that injects the build id is not applied under the test config.
const BUILD_ID = "purge-reads-build";
/** The fork's first collection whose entries publish a page from `previewUrl`. */
const PAGE_COLLECTION = collectionSlugs.find(
  (collectionSlug): collectionSlug is CollectionsUnion => "previewUrl" in cmsConfig.collections[collectionSlug],
);

async function clearRows(): Promise<void> {
  await env.D1_DB.batch([
    env.D1_DB.prepare("DELETE FROM cms_navigation_item"),
    env.D1_DB.prepare("DELETE FROM cms_entry_version"),
    env.D1_DB.prepare("DELETE FROM cms_entry_tag"),
    env.D1_DB.prepare("DELETE FROM cms_entry"),
    env.D1_DB.prepare("DELETE FROM cms_tag"),
    env.D1_DB.prepare("DELETE FROM user"),
  ]);
}

describe("the CMS page purge reads against D1", () => {
  beforeEach(async () => {
    await clearRows();
    await db.insert(userTable).values({ ...AUTHOR, email: "purge-reads@example.com" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Without a zone purge only the local delete runs, and it cannot match the root prefix.
  it.skipIf(!PAGE_COLLECTION).each([
    CMS_INVALIDATION_SCOPES.SITE_HEADER,
    CMS_INVALIDATION_SCOPES.ALL_CMS,
  ])("a %s purge deletes the stored page of each published entry row", async (scope) => {
    vi.stubGlobal("__MARKDOWN_BUILD_ID__", BUILD_ID);
    // The DOM lib types `caches` without the Workers-only `default`, which workerd provides here.
    const deleteSpy = vi.spyOn((caches as CacheStorage & { default: Cache }).default, "delete");
    const collection = PAGE_COLLECTION as CollectionsUnion;
    const seeds = [
      { slug: "root-published", status: CMS_ENTRY_STATUS.PUBLISHED, locale: DEFAULT_LOCALE },
      { slug: "root-draft", status: CMS_ENTRY_STATUS.DRAFT, locale: DEFAULT_LOCALE },
      ...(NON_DEFAULT_LOCALE
        ? [{ slug: "root-published", status: CMS_ENTRY_STATUS.PUBLISHED, locale: NON_DEFAULT_LOCALE }]
        : []),
    ];
    await db.insert(cmsEntryTable).values(seeds.map((seed) => ({
      ...seed,
      collection,
      title: seed.slug,
      content: {},
      createdBy: AUTHOR.id,
    })));

    await purgeCmsPages({
      entries: [],
      navigationKeys: [],
      readAllEntryRefs: getAllCmsEntryRefs,
      scopes: [scope],
    });

    const deletedKeys = deleteSpy.mock.calls.map(([key]) => String(key));
    const wasDeleted = ({ slug, locale }: { slug: string; locale: (typeof ENABLED_LOCALES)[number] }) => {
      const servedPathname = localizedPathname({ pathname: cmsEntryPagePath({ collection, slug }) as string, locale });

      return deletedKeys.some((key) => key.endsWith(`/${BUILD_ID}${servedPathname}`));
    };

    for (const locale of ENABLED_LOCALES) {
      expect(wasDeleted({ slug: "root-published", locale })).toBe(true);
      expect(wasDeleted({ slug: "root-draft", locale })).toBe(false);
    }
  });

  it("counts the published blog posts of the blog list, each tag page, and each author page", async () => {
    const [tag] = await db
      .insert(cmsTagTable)
      .values({ createdBy: AUTHOR.id, name: "Purge Reads", slug: TAG_SLUG })
      .returning({ id: cmsTagTable.id });
    const seeds = [
      { slug: "published-post", status: CMS_ENTRY_STATUS.PUBLISHED, locale: DEFAULT_LOCALE },
      { slug: "draft-post", status: CMS_ENTRY_STATUS.DRAFT, locale: DEFAULT_LOCALE },
      ...(NON_DEFAULT_LOCALE
        ? [{ slug: "published-post", status: CMS_ENTRY_STATUS.PUBLISHED, locale: NON_DEFAULT_LOCALE }]
        : []),
    ];
    const entries = await db
      .insert(cmsEntryTable)
      .values(seeds.map((seed) => ({
        ...seed,
        collection: BLOG_COLLECTION_SLUG,
        title: seed.slug,
        content: {},
        createdBy: AUTHOR.id,
      })))
      .returning({ id: cmsEntryTable.id });
    await db.insert(cmsEntryTagTable).values(entries.map((entry) => ({ entryId: entry.id, tagId: tag.id })));

    // Every locale adds up: the count is an upper bound for one locale's page count.
    const publishedCount = seeds.filter(({ status }) => status === CMS_ENTRY_STATUS.PUBLISHED).length;

    expect(await getBlogListingPostCounts()).toEqual(expect.arrayContaining([
      { pathname: BLOG_BASE_PATH, postCount: publishedCount },
      { pathname: getBlogTagPagePath(TAG_SLUG), postCount: publishedCount },
      { pathname: getBlogAuthorPagePath(AUTHOR), postCount: publishedCount },
    ]));
  });

  // A save removes the rows of a deleted link, so its caller reads this before the save.
  it.skipIf(!NAVIGATION_KEY)("reads every page path of a navigation tree, in any publish status", async () => {
    const navigationKey = NAVIGATION_KEY ?? DOCS_SLUG;
    const pagePath = `${getCmsNavigationConfig(navigationKey).basePath}/draft-page`;
    const [draft] = await db
      .insert(cmsEntryTable)
      .values({
        collection: DOCS_SLUG,
        title: "Draft",
        content: {},
        slug: "draft-page",
        locale: DEFAULT_LOCALE,
        status: CMS_ENTRY_STATUS.DRAFT,
        createdBy: AUTHOR.id,
      })
      .returning({ id: cmsEntryTable.id });
    await db.insert(cmsNavigationItemTable).values([
      {
        navigationKey,
        nodeType: CMS_NAVIGATION_NODE_TYPES.PAGE,
        title: "Draft",
        entryId: draft.id,
        slugSegment: "draft-page",
        resolvedPath: pagePath,
        sortOrder: 0,
      },
      {
        navigationKey,
        nodeType: CMS_NAVIGATION_NODE_TYPES.GROUP,
        title: "Group",
        sortOrder: 1,
      },
    ]);

    await expect(getCmsNavigationPagePaths({ navigationKeys: [navigationKey] }))
      .resolves.toEqual([pagePath]);
  });

  // The cached tree can lag a write, so the header count goes to D1 with the tree's live rule.
  it("counts the live pages of the site header navigation: published default-locale pages only", async () => {
    const { basePath, collectionSlug } = getCmsNavigationConfig(SITE_HEADER_NAVIGATION_KEY);
    const seeds = [
      { slug: "count-draft", status: CMS_ENTRY_STATUS.DRAFT, locale: DEFAULT_LOCALE },
      { slug: "count-live", status: CMS_ENTRY_STATUS.PUBLISHED, locale: DEFAULT_LOCALE },
      { slug: "count-unlinked", status: CMS_ENTRY_STATUS.PUBLISHED, locale: DEFAULT_LOCALE },
      ...(NON_DEFAULT_LOCALE
        ? [{ slug: "count-live", status: CMS_ENTRY_STATUS.PUBLISHED, locale: NON_DEFAULT_LOCALE }]
        : []),
    ];
    const entries = await db
      .insert(cmsEntryTable)
      .values(seeds.map((seed) => ({
        ...seed,
        collection: collectionSlug,
        title: seed.slug,
        content: {},
        createdBy: AUTHOR.id,
      })))
      .returning({ id: cmsEntryTable.id, slug: cmsEntryTable.slug, locale: cmsEntryTable.locale });
    const linkedEntries = entries.filter((entry) => entry.locale === DEFAULT_LOCALE && entry.slug !== "count-unlinked");

    await expect(getFreshCmsNavigationLivePageCount({ navigationKey: SITE_HEADER_NAVIGATION_KEY })).resolves.toBe(0);

    const [group] = await db
      .insert(cmsNavigationItemTable)
      .values({
        navigationKey: SITE_HEADER_NAVIGATION_KEY,
        nodeType: CMS_NAVIGATION_NODE_TYPES.GROUP,
        title: "Group",
        sortOrder: 0,
      })
      .returning({ id: cmsNavigationItemTable.id });
    await db.insert(cmsNavigationItemTable).values(linkedEntries.map((entry, sortOrder) => ({
      navigationKey: SITE_HEADER_NAVIGATION_KEY,
      parentId: group.id,
      nodeType: CMS_NAVIGATION_NODE_TYPES.PAGE,
      title: entry.slug,
      entryId: entry.id,
      slugSegment: entry.slug,
      resolvedPath: `${basePath}/${entry.slug}`,
      sortOrder,
    })));

    await expect(getFreshCmsNavigationLivePageCount({ navigationKey: SITE_HEADER_NAVIGATION_KEY })).resolves.toBe(1);
  });
});
