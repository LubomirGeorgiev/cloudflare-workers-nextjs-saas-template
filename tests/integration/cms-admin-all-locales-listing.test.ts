/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getDB } from "@/db";
import { cmsEntryTable, userTable } from "@/db/schema";
import { getCmsCollection, getCmsCollectionCount } from "@/lib/cms/entry";

// `getCmsCollection`/`getCmsCollectionCount` are wrapped in `"use cache: remote"`
// functions that call `cacheTag`/`cacheLife`. Those throw outside of Next's
// `cacheComponents` runtime, which this Workers-runtime integration environment
// doesn't provide. Stub them so the underlying D1 query (the thing this test
// actually verifies) still runs.
vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
  revalidateTag: vi.fn(),
}));

const db = getDB();

// Admin CMS listing must surface every locale's rows (Phase 3 review fix): a
// newly created 'es' DRAFT translation must be visible/editable from the admin
// table, not hidden behind the public read path's default-to-'en' filtering.
const COLLECTION_SLUG = "blog";
const SHARED_SLUG = "admin-all-locales-test-post";

async function clearCmsLocaleRows(): Promise<void> {
  await env.NEXT_TAG_CACHE_D1.batch([
    env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM cms_entry"),
    env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM user"),
  ]);
}

async function seedUser(): Promise<string> {
  const [user] = await db
    .insert(userTable)
    .values({
      id: "usr_admin_all_locales_test",
      email: "cms-admin-all-locales-author@example.com",
    })
    .returning({ id: userTable.id });

  return user.id;
}

describe("admin CMS listing surfaces every locale", () => {
  beforeEach(async () => {
    await clearCmsLocaleRows();
  });

  it("getCmsCollection with allLocales:true returns rows across every locale, including non-default-locale drafts", async () => {
    const createdBy = await seedUser();

    await db.insert(cmsEntryTable).values([
      {
        collection: COLLECTION_SLUG,
        title: "Hello",
        content: {},
        slug: SHARED_SLUG,
        locale: "en",
        status: CMS_ENTRY_STATUS.PUBLISHED,
        createdBy,
      },
      {
        collection: COLLECTION_SLUG,
        title: "Hola (draft)",
        content: {},
        slug: SHARED_SLUG,
        locale: "es",
        status: CMS_ENTRY_STATUS.DRAFT,
        createdBy,
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    ] as any);

    // Default (locale-scoped) behavior is unchanged: only 'en' rows.
    const defaultLocaleOnly = await getCmsCollection({
      collectionSlug: COLLECTION_SLUG,
      status: "all",
    });
    expect(defaultLocaleOnly).toHaveLength(1);
    expect(defaultLocaleOnly[0]?.locale).toBe("en");

    // All-locales mode (admin listing) must include the 'es' draft too.
    const allLocales = await getCmsCollection({
      collectionSlug: COLLECTION_SLUG,
      status: "all",
      allLocales: true,
    });
    const locales = allLocales.map((entry) => entry.locale).sort();
    expect(locales).toEqual(["en", "es"]);

    const esEntry = allLocales.find((entry) => entry.locale === "es");
    expect(esEntry?.title).toBe("Hola (draft)");
    expect(esEntry?.status).toBe(CMS_ENTRY_STATUS.DRAFT);
  });

  it("getCmsCollectionCount with allLocales:true counts rows across every locale", async () => {
    const createdBy = await seedUser();

    await db.insert(cmsEntryTable).values([
      {
        collection: COLLECTION_SLUG,
        title: "Hello",
        content: {},
        slug: SHARED_SLUG,
        locale: "en",
        status: CMS_ENTRY_STATUS.PUBLISHED,
        createdBy,
      },
      {
        collection: COLLECTION_SLUG,
        title: "Hola (draft)",
        content: {},
        slug: SHARED_SLUG,
        locale: "es",
        status: CMS_ENTRY_STATUS.DRAFT,
        createdBy,
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    ] as any);

    const defaultLocaleCount = await getCmsCollectionCount({
      collectionSlug: COLLECTION_SLUG,
      status: "all",
    });
    expect(defaultLocaleCount).toBe(1);

    const allLocalesCount = await getCmsCollectionCount({
      collectionSlug: COLLECTION_SLUG,
      status: "all",
      allLocales: true,
    });
    expect(allLocalesCount).toBe(2);
  });
});
