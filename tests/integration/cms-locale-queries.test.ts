/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getDB } from "@/db";
import { cmsEntryTable, userTable } from "@/db/schema";
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

// Same (collection, slug) shared by an 'en' row and its 'es' translation, per the
// Phase 3 translation-group model: rows differ only by locale.
const COLLECTION_SLUG = "blog";
const SHARED_SLUG = "locale-query-test-post";
const EN_ONLY_SLUG = "locale-query-test-en-only";

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

  it("returns the row matching the requested locale, defaults to 'en', and returns undefined for missing translations", async () => {
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
        title: "Hola",
        content: {},
        slug: SHARED_SLUG,
        locale: "es",
        status: CMS_ENTRY_STATUS.PUBLISHED,
        createdBy,
      },
      {
        collection: COLLECTION_SLUG,
        title: "English only",
        content: {},
        slug: EN_ONLY_SLUG,
        locale: "en",
        status: CMS_ENTRY_STATUS.PUBLISHED,
        createdBy,
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    ] as any);

    const esEntry = await getCmsEntryBySlug({
      collectionSlug: COLLECTION_SLUG,
      slug: SHARED_SLUG,
      locale: "es",
    });
    expect(esEntry?.title).toBe("Hola");
    expect(esEntry?.locale).toBe("es");

    const enEntry = await getCmsEntryBySlug({
      collectionSlug: COLLECTION_SLUG,
      slug: SHARED_SLUG,
      locale: "en",
    });
    expect(enEntry?.title).toBe("Hello");
    expect(enEntry?.locale).toBe("en");

    const defaultEntry = await getCmsEntryBySlug({
      collectionSlug: COLLECTION_SLUG,
      slug: SHARED_SLUG,
    });
    expect(defaultEntry?.title).toBe("Hello");
    expect(defaultEntry?.locale).toBe("en");

    const missingTranslation = await getCmsEntryBySlug({
      collectionSlug: COLLECTION_SLUG,
      slug: EN_ONLY_SLUG,
      locale: "es",
    });
    expect(missingTranslation).toBeFalsy();
  });

  it("getEntryLocales returns every locale that exists for a translation group", async () => {
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
        title: "Hola",
        content: {},
        slug: SHARED_SLUG,
        locale: "es",
        status: CMS_ENTRY_STATUS.PUBLISHED,
        createdBy,
      },
      // oxlint-disable-next-line typescript/no-explicit-any
    ] as any);

    const locales = await getEntryLocales({
      collectionSlug: COLLECTION_SLUG,
      slug: SHARED_SLUG,
    });

    expect([...locales].sort()).toEqual(["en", "es"]);
  });
});
