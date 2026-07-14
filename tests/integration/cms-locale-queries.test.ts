/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getDB } from "@/db";
import { cmsEntryTable, userTable } from "@/db/schema";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/i18n/config";
import { getCmsEntryBySlug, getEntryLocales } from "@/lib/cms/entry";

// `getCmsEntryBySlug` is wrapped in a `"use cache: remote"` function that calls `cacheTag`/`cacheLife`.
// Those throw outside of Next's `cacheComponents` runtime, which this Workers-runtime integration
// environment doesn't provide. Stub them so the underlying D1 query (the thing this test actually verifies) still runs.
vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
  revalidateTag: vi.fn(),
}));

const db = getDB();

// Same (collection, slug) shared by default and translated rows; rows differ only
// by locale.
const COLLECTION_SLUG = "blog";
const SHARED_SLUG = "locale-query-test-post";
const DEFAULT_ONLY_SLUG = "locale-query-test-default-only";
const NON_DEFAULT_LOCALE = LOCALES.find((locale) => locale !== DEFAULT_LOCALE) as Locale;

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
      id: "usr_locale_query_test",
      email: "cms-locale-query-author@example.com",
    })
    .returning({ id: userTable.id });

  return user.id;
}

describe("CMS entry read layer locale filtering", () => {
  beforeEach(async () => {
    await clearCmsLocaleRows();
  });

  it("returns the requested locale, defaults to DEFAULT_LOCALE, and leaves missing translations undefined", async () => {
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
        title: "Translated entry",
        content: {},
        slug: SHARED_SLUG,
        locale: NON_DEFAULT_LOCALE,
        status: CMS_ENTRY_STATUS.PUBLISHED,
        createdBy,
      },
      {
        collection: COLLECTION_SLUG,
        title: "Default only",
        content: {},
        slug: DEFAULT_ONLY_SLUG,
        locale: DEFAULT_LOCALE,
        status: CMS_ENTRY_STATUS.PUBLISHED,
        createdBy,
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    ] as any);

    const translatedEntry = await getCmsEntryBySlug({
      collectionSlug: COLLECTION_SLUG,
      slug: SHARED_SLUG,
      locale: NON_DEFAULT_LOCALE,
    });
    expect(translatedEntry?.title).toBe("Translated entry");
    expect(translatedEntry?.locale).toBe(NON_DEFAULT_LOCALE);

    const defaultLocaleEntry = await getCmsEntryBySlug({
      collectionSlug: COLLECTION_SLUG,
      slug: SHARED_SLUG,
      locale: DEFAULT_LOCALE,
    });
    expect(defaultLocaleEntry?.title).toBe("Default entry");
    expect(defaultLocaleEntry?.locale).toBe(DEFAULT_LOCALE);

    const defaultEntry = await getCmsEntryBySlug({
      collectionSlug: COLLECTION_SLUG,
      slug: SHARED_SLUG,
    });
    expect(defaultEntry?.title).toBe("Default entry");
    expect(defaultEntry?.locale).toBe(DEFAULT_LOCALE);

    const missingTranslation = await getCmsEntryBySlug({
      collectionSlug: COLLECTION_SLUG,
      slug: DEFAULT_ONLY_SLUG,
      locale: NON_DEFAULT_LOCALE,
    });
    expect(missingTranslation).toBeFalsy();
  });

  it("getEntryLocales returns every locale that exists for a translation group", async () => {
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
        title: "Translated entry",
        content: {},
        slug: SHARED_SLUG,
        locale: NON_DEFAULT_LOCALE,
        status: CMS_ENTRY_STATUS.PUBLISHED,
        createdBy,
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    ] as any);

    const locales = await getEntryLocales({
      collectionSlug: COLLECTION_SLUG,
      slug: SHARED_SLUG,
    });

    expect([...locales].sort()).toEqual([DEFAULT_LOCALE, NON_DEFAULT_LOCALE].sort());
  });
});
