/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getDB } from "@/db";
import { cmsEntryTable, cmsEntryTagTable, cmsTagTable, userTable } from "@/db/schema";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/i18n/config";
import { createCmsEntryTranslation } from "@/lib/cms/entry/mutations";

// `createCmsEntryTranslation` invalidates CMS caches via `revalidateCacheTag`, which
// (like `cacheTag`/`cacheLife`) requires Next's `cacheComponents` runtime. Stub it so
// the underlying D1 mutation (the thing this test actually verifies) still runs.
vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
  revalidateTag: vi.fn(),
  revalidatePath: vi.fn(),
}));

const db = getDB();

// Same (collection, slug) translation group used across the Phase 3 locale tests:
// rows differ only by locale.
const COLLECTION_SLUG = "blog";
const SHARED_SLUG = "create-translation-test-post";
const NON_DEFAULT_LOCALE = LOCALES.find((locale) => locale !== DEFAULT_LOCALE) as Locale;

async function clearCmsLocaleRows(): Promise<void> {
  await env.NEXT_TAG_CACHE_D1.batch([
    env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM cms_entry_tag"),
    env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM cms_tag"),
    env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM cms_entry"),
    env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM user"),
  ]);
}

async function seedUser(id: string): Promise<string> {
  const [user] = await db
    .insert(userTable)
    .values({
      id,
      email: `${id}@example.com`,
    })
    .returning({ id: userTable.id });

  return user.id;
}

describe("createCmsEntryTranslation", () => {
  beforeEach(async () => {
    await clearCmsLocaleRows();
  });

  it("creates a draft sibling row sharing (collection, slug) with the copied content, without modifying the source", async () => {
    const authorId = await seedUser("usr_create_translation_author");
    const translatorId = await seedUser("usr_create_translation_translator");

    const [tag] = await db
      .insert(cmsTagTable)
      .values({ name: "Announcements", slug: "announcements", createdBy: authorId })
      .returning({ id: cmsTagTable.id });

    const [sourceEntry] = await db
      .insert(cmsEntryTable)
      .values({
        collection: COLLECTION_SLUG,
        title: "Source entry",
        content: { type: "doc", content: [{ type: "paragraph" }] },
        fields: { subtitle: "Greeting" },
        slug: SHARED_SLUG,
        locale: DEFAULT_LOCALE,
        status: CMS_ENTRY_STATUS.PUBLISHED,
        seoDescription: "A source-locale post.",
        createdBy: authorId,
        // oxlint-disable-next-line typescript/no-explicit-any
      } as any)
      .returning();

    await db.insert(cmsEntryTagTable).values({
      entryId: sourceEntry.id,
      tagId: tag.id,
    });

    // autoTranslate: false keeps this a deterministic copy-semantics test,
    // independent of the AI binding.
    const translation = await createCmsEntryTranslation({
      collectionSlug: COLLECTION_SLUG,
      slug: SHARED_SLUG,
      sourceLocale: DEFAULT_LOCALE,
      targetLocale: NON_DEFAULT_LOCALE,
      createdBy: translatorId,
      autoTranslate: false,
    });

    expect(translation.id).not.toBe(sourceEntry.id);
    expect(translation.collection).toBe(COLLECTION_SLUG);
    expect(translation.slug).toBe(SHARED_SLUG);
    expect(translation.locale).toBe(NON_DEFAULT_LOCALE);
    expect(translation.status).toBe(CMS_ENTRY_STATUS.DRAFT);
    expect(translation.title).toBe("Source entry");
    expect(translation.content).toEqual(sourceEntry.content);
    expect(translation.fields).toEqual(sourceEntry.fields);
    expect(translation.seoDescription).toBe(sourceEntry.seoDescription);
    expect(translation.featuredImageId).toBe(sourceEntry.featuredImageId);
    expect(translation.createdBy).toBe(translatorId);

    // Source row must be untouched.
    const reloadedSource = await db.query.cmsEntryTable.findFirst({
      where: { id: sourceEntry.id },
    });
    expect(reloadedSource?.status).toBe(CMS_ENTRY_STATUS.PUBLISHED);
    expect(reloadedSource?.locale).toBe(DEFAULT_LOCALE);
    expect(reloadedSource?.title).toBe("Source entry");

    // Tag associations copied to the new row.
    const copiedTags = await db.query.cmsEntryTagTable.findMany({
      where: { entryId: translation.id },
    });
    expect(copiedTags.map((t) => t.tagId)).toEqual([tag.id]);

    // A second translation into the same target locale must be rejected.
    await expect(
      createCmsEntryTranslation({
        collectionSlug: COLLECTION_SLUG,
        slug: SHARED_SLUG,
        sourceLocale: DEFAULT_LOCALE,
        targetLocale: NON_DEFAULT_LOCALE,
        createdBy: translatorId,
        autoTranslate: false,
      })
    ).rejects.toThrow();
  });

  it("still produces a valid draft copy when AI auto-translation is unavailable (fallback path)", async () => {
    const authorId = await seedUser("usr_translation_ai_fallback_author");
    const translatorId = await seedUser("usr_translation_ai_fallback_translator");

    const [sourceEntry] = await db
      .insert(cmsEntryTable)
      .values({
        collection: COLLECTION_SLUG,
        title: "Source entry",
        content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }] },
        fields: { subtitle: "Greeting" },
        slug: SHARED_SLUG,
        locale: DEFAULT_LOCALE,
        status: CMS_ENTRY_STATUS.PUBLISHED,
        seoDescription: "A source-locale post.",
        createdBy: authorId,
        // oxlint-disable-next-line typescript/no-explicit-any
      } as any)
      .returning();

    // Default autoTranslate (true). The workers test env has no working AI model,
    // so translateEntryFields falls back to a verbatim copy — the draft must still
    // be a structurally valid sibling row, never broken or empty.
    const translation = await createCmsEntryTranslation({
      collectionSlug: COLLECTION_SLUG,
      slug: SHARED_SLUG,
      sourceLocale: DEFAULT_LOCALE,
      targetLocale: NON_DEFAULT_LOCALE,
      createdBy: translatorId,
    });

    expect(translation.locale).toBe(NON_DEFAULT_LOCALE);
    expect(translation.slug).toBe(SHARED_SLUG);
    expect(translation.status).toBe(CMS_ENTRY_STATUS.DRAFT);
    expect(typeof translation.title).toBe("string");
    expect(translation.title.length).toBeGreaterThan(0);
    expect(translation.content).toBeTypeOf("object");

    // Source row is untouched.
    const reloadedSource = await db.query.cmsEntryTable.findFirst({
      where: { id: sourceEntry.id },
    });
    expect(reloadedSource?.status).toBe(CMS_ENTRY_STATUS.PUBLISHED);
    expect(reloadedSource?.title).toBe("Source entry");
  });

  it("throws when the source locale row does not exist", async () => {
    const authorId = await seedUser("usr_create_translation_missing_source");

    await db.insert(cmsEntryTable).values({
      collection: COLLECTION_SLUG,
      title: "Source entry",
      content: {},
      slug: SHARED_SLUG,
      locale: DEFAULT_LOCALE,
      status: CMS_ENTRY_STATUS.PUBLISHED,
      createdBy: authorId,
      // oxlint-disable-next-line typescript/no-explicit-any
    } as any);

    await expect(
      createCmsEntryTranslation({
        collectionSlug: COLLECTION_SLUG,
        slug: SHARED_SLUG,
        // No non-default row was seeded, so the source lookup fails first.
        sourceLocale: NON_DEFAULT_LOCALE,
        targetLocale: DEFAULT_LOCALE,
        createdBy: authorId,
      })
    ).rejects.toThrow();
  });
});
