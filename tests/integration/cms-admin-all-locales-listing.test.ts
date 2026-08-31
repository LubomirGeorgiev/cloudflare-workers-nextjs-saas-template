/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getDB } from "@/db";
import { cmsEntryTable, userTable } from "@/db/schema";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/i18n/config";
import { getCmsCollection, getCmsCollectionCount } from "@/lib/cms/entry";

// `getCmsCollection`/`getCmsCollectionCount` are wrapped in `"use cache: remote"` functions that call
// `cacheTag`/`cacheLife`. Those throw outside of Next's `cacheComponents` runtime, which this
// Workers-runtime integration environment doesn't provide. Stub them so the underlying D1 query (the thing this test actually verifies) still runs.
vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
  revalidateTag: vi.fn(),
}));

const db = getDB();

// Admin CMS listing must surface every locale's rows: a newly created non-default
// DRAFT translation must be visible/editable instead of hidden behind the public
// read path's default-locale filtering.
const COLLECTION_SLUG = "blog";
const SHARED_SLUG = "admin-all-locales-test-post";
const NON_DEFAULT_LOCALE = LOCALES.find((locale) => locale !== DEFAULT_LOCALE) as Locale;

async function clearCmsLocaleRows(): Promise<void> {
  await env.D1_DB.batch([
    env.D1_DB.prepare("DELETE FROM cms_entry"),
    env.D1_DB.prepare("DELETE FROM user"),
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
        title: "Default entry",
        content: {},
        slug: SHARED_SLUG,
        locale: DEFAULT_LOCALE,
        status: CMS_ENTRY_STATUS.PUBLISHED,
        createdBy,
      },
      {
        collection: COLLECTION_SLUG,
        title: "Translated draft",
        content: {},
        slug: SHARED_SLUG,
        locale: NON_DEFAULT_LOCALE,
        status: CMS_ENTRY_STATUS.DRAFT,
        createdBy,
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    ] as any);

    // Default locale-scoped behavior still returns only the canonical row.
    const defaultLocaleOnly = await getCmsCollection({
      collectionSlug: COLLECTION_SLUG,
      status: "all",
    });
    expect(defaultLocaleOnly).toHaveLength(1);
    expect(defaultLocaleOnly[0]?.locale).toBe(DEFAULT_LOCALE);

    // All-locales mode (admin listing) must include the translated draft too.
    const allLocales = await getCmsCollection({
      collectionSlug: COLLECTION_SLUG,
      status: "all",
      allLocales: true,
    });
    const locales = allLocales.map((entry) => entry.locale).sort();
    expect(locales).toEqual([DEFAULT_LOCALE, NON_DEFAULT_LOCALE].sort());

    const translatedEntry = allLocales.find((entry) => entry.locale === NON_DEFAULT_LOCALE);
    expect(translatedEntry?.title).toBe("Translated draft");
    expect(translatedEntry?.status).toBe(CMS_ENTRY_STATUS.DRAFT);
  });

  it("getCmsCollectionCount with allLocales:true counts rows across every locale", async () => {
    const createdBy = await seedUser();

    await db.insert(cmsEntryTable).values([
      {
        collection: COLLECTION_SLUG,
        title: "Default entry",
        content: {},
        slug: SHARED_SLUG,
        locale: DEFAULT_LOCALE,
        status: CMS_ENTRY_STATUS.PUBLISHED,
        createdBy,
      },
      {
        collection: COLLECTION_SLUG,
        title: "Translated draft",
        content: {},
        slug: SHARED_SLUG,
        locale: NON_DEFAULT_LOCALE,
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
