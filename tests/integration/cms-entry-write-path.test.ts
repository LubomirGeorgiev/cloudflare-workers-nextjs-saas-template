/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, test } from "vitest";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getDB } from "@/db";
import {
  cmsEntryTable,
  cmsMediaTable,
  cmsTagTable,
  userTable,
} from "@/db/schema";
import {
  createCmsEntry,
  createCmsEntryTranslation,
  deleteCmsEntry,
  updateCmsEntry,
} from "@/lib/cms/entry";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";
import { SCHEDULED_JOB_TYPES } from "@/lib/scheduler/jobs";

// A non-default locale from the template's full catalog, or undefined for a
// single-locale downstream config (then the translation-group tests are skipped).
const translationLocale = LOCALES.find((locale) => locale !== DEFAULT_LOCALE);

const db = getDB();
const dayInMs = 24 * 60 * 60 * 1000;

function secondsDate(time: number): Date {
  return new Date(Math.floor(time / 1000) * 1000);
}

const testContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Initial integration search phrase",
        },
      ],
    },
  ],
};

const updatedContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "Updated integration search phrase",
        },
      ],
    },
    {
      type: "image",
      attrs: {
        src: "/api/cms-images/cms-images/docs/integration-image.png",
        alt: "Integration image",
      },
    },
  ],
};

async function clearKV(): Promise<void> {
  const keys = await env.KV_STORE.list();
  await Promise.all(keys.keys.map((key) => env.KV_STORE.delete(key.name)));
}

async function clearCmsRows(): Promise<void> {
  await env.D1_DB.batch([
    env.D1_DB.prepare("DELETE FROM scheduled_job"),
    env.D1_DB.prepare("DELETE FROM cms_entry_search"),
    env.D1_DB.prepare("DELETE FROM cms_entry_media"),
    env.D1_DB.prepare("DELETE FROM cms_entry_tag"),
    env.D1_DB.prepare("DELETE FROM cms_entry_version"),
    env.D1_DB.prepare("DELETE FROM cms_entry"),
    env.D1_DB.prepare("DELETE FROM cms_media"),
    env.D1_DB.prepare("DELETE FROM cms_tag"),
    env.D1_DB.prepare("DELETE FROM user"),
  ]);
}

async function seedCmsAuthor(): Promise<string> {
  const [user] = await db
    .insert(userTable)
    .values({
      id: "cms-write-author",
      email: "cms-write-author@example.com",
    })
    .returning({ id: userTable.id });

  return user.id;
}

async function seedCmsMedia({ uploadedBy }: { uploadedBy: string }): Promise<string> {
  const [media] = await db
    .insert(cmsMediaTable)
    .values({
      id: "cms-write-media",
      alt: "Original alt",
      bucketKey: "cms-images/docs/integration-image.png",
      fileName: "integration-image.png",
      height: 120,
      mimeType: "image/png",
      sizeInBytes: 512,
      uploadedBy,
      width: 240,
    })
    .returning({ id: cmsMediaTable.id });

  return media.id;
}

async function seedCmsTag({ createdBy }: { createdBy: string }): Promise<string> {
  const [tag] = await db
    .insert(cmsTagTable)
    .values({
      id: "cms-write-tag",
      createdBy,
      name: "Integration Tag",
      slug: "integration-tag",
    })
    .returning({ id: cmsTagTable.id });

  return tag.id;
}

async function countSearchRows(entryId: string): Promise<number> {
  const row = await env.D1_DB
    .prepare("SELECT count(*) AS count FROM cms_entry_search WHERE entryId = ?")
    .bind(entryId)
    .first<{ count: number | string }>();

  return Number(row?.count ?? 0);
}

async function getSearchSlug(entryId: string): Promise<string | null> {
  const row = await env.D1_DB
    .prepare("SELECT slug FROM cms_entry_search WHERE entryId = ?")
    .bind(entryId)
    .first<{ slug: string }>();

  return row?.slug ?? null;
}

describe("CMS entry write path integration", () => {
  beforeEach(async () => {
    await clearKV();
    await clearCmsRows();
  });

  test("create, update, and delete keep D1, search, media, and schedule state in sync", async () => {
    const authorId = await seedCmsAuthor();
    const mediaId = await seedCmsMedia({ uploadedBy: authorId });
    const tagId = await seedCmsTag({ createdBy: authorId });
    const publishedAt = secondsDate(Date.now() + 3 * dayInMs);

    const createdEntry = await createCmsEntry({
      collectionSlug: "docs",
      content: testContent,
      createdBy: authorId,
      fields: {},
      publishedAt,
      seoDescription: "Initial integration SEO description",
      slug: "integration-write-path",
      status: CMS_ENTRY_STATUS.SCHEDULED,
      title: "Integration Write Path",
      tagIds: [tagId],
    });

    expect(await countSearchRows(createdEntry.id)).toBe(1);
    await expect(db.query.scheduledJobTable.findFirst({
      where: { dedupeKey: `cms-entry:${createdEntry.id}` },
    })).resolves.toEqual(expect.objectContaining({
      payload: { entryId: createdEntry.id },
      runAt: publishedAt,
      type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
    }));
    await expect(db.query.cmsEntryTagTable.findMany({
      where: { entryId: createdEntry.id },
    })).resolves.toHaveLength(1);

    const updatedEntry = await updateCmsEntry({
      id: createdEntry.id,
      content: updatedContent,
      featuredImageId: mediaId,
      seoDescription: "Updated integration SEO description",
      slug: "integration-write-path-updated",
      status: CMS_ENTRY_STATUS.PUBLISHED,
      tagIds: [],
      title: "Updated Integration Write Path",
    });

    expect(updatedEntry?.status).toBe(CMS_ENTRY_STATUS.PUBLISHED);
    expect(updatedEntry?.publishedAt).toBeInstanceOf(Date);
    await expect(countSearchRows(createdEntry.id)).resolves.toBe(1);
    await expect(db.query.scheduledJobTable.findMany({
      where: { dedupeKey: `cms-entry:${createdEntry.id}` },
    })).resolves.toHaveLength(0);
    await expect(db.query.cmsEntryMediaTable.findMany({
      where: { entryId: createdEntry.id },
    })).resolves.toEqual([
      expect.objectContaining({
        mediaId,
      }),
    ]);
    await expect(db.query.cmsEntryTagTable.findMany({
      where: { entryId: createdEntry.id },
    })).resolves.toHaveLength(0);
    await expect(db.query.cmsEntryVersionTable.findMany({
      where: { entryId: createdEntry.id },
    })).resolves.toEqual([
      expect.objectContaining({
        slug: createdEntry.slug,
        versionNumber: 1,
      }),
      expect.objectContaining({
        slug: "integration-write-path-updated",
        versionNumber: 2,
      }),
    ]);

    await deleteCmsEntry({ id: createdEntry.id });

    await expect(db.query.cmsEntryTable.findFirst({
      where: { id: createdEntry.id },
    })).resolves.toBeUndefined();
    await expect(countSearchRows(createdEntry.id)).resolves.toBe(0);
    await expect(db.query.cmsEntryMediaTable.findMany({
      where: { entryId: createdEntry.id },
    })).resolves.toHaveLength(0);
    await expect(db.query.scheduledJobTable.findMany({
      where: { dedupeKey: `cms-entry:${createdEntry.id}` },
    })).resolves.toHaveLength(0);
  });

  test.skipIf(!translationLocale)(
    "creates the default-locale entry when only a translation row uses the slug",
    async () => {
      const authorId = await seedCmsAuthor();

      await db.insert(cmsEntryTable).values({
        collection: "docs",
        content: testContent,
        createdBy: authorId,
        fields: {},
        locale: translationLocale!,
        seoDescription: "Orphaned translation SEO description",
        slug: "orphaned-translation-slug",
        status: CMS_ENTRY_STATUS.PUBLISHED,
        title: "Orphaned Translation",
      });

      const defaultEntry = await createCmsEntry({
        collectionSlug: "docs",
        content: testContent,
        createdBy: authorId,
        fields: {},
        seoDescription: "Default anchor SEO description",
        slug: "orphaned-translation-slug",
        status: CMS_ENTRY_STATUS.PUBLISHED,
        title: "Default Anchor",
        tagIds: [],
      });

      expect(defaultEntry.locale).toBe(DEFAULT_LOCALE);
      await expect(db.query.cmsEntryTable.findMany({
        where: { collection: "docs", slug: "orphaned-translation-slug" },
      })).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ locale: DEFAULT_LOCALE, title: "Default Anchor" }),
        expect.objectContaining({ locale: translationLocale, title: "Orphaned Translation" }),
      ]));
    }
  );

  test.skipIf(!translationLocale)(
    "renaming the default-locale entry updates search rows for translation siblings",
    async () => {
      const authorId = await seedCmsAuthor();

      const defaultEntry = await createCmsEntry({
        collectionSlug: "docs",
        content: testContent,
        createdBy: authorId,
        fields: {},
        seoDescription: "Translation rename SEO description",
        slug: "translation-search-rename",
        status: CMS_ENTRY_STATUS.PUBLISHED,
        title: "Translation Search Rename",
        tagIds: [],
      });

      const translation = await createCmsEntryTranslation({
        collectionSlug: "docs",
        slug: "translation-search-rename",
        sourceLocale: DEFAULT_LOCALE,
        targetLocale: translationLocale!,
        createdBy: authorId,
        autoTranslate: false,
      });

      await updateCmsEntry({
        id: defaultEntry.id,
        slug: "translation-search-renamed",
      });

      await expect(getSearchSlug(defaultEntry.id)).resolves.toBe("translation-search-renamed");
      await expect(getSearchSlug(translation.id)).resolves.toBe("translation-search-renamed");
      await expect(countSearchRows(defaultEntry.id)).resolves.toBe(1);
      await expect(countSearchRows(translation.id)).resolves.toBe(1);
    }
  );

  test.skipIf(!translationLocale)(
    "deleting the default-locale entry deletes the whole translation group",
    async () => {
      const authorId = await seedCmsAuthor();

      const defaultEntry = await createCmsEntry({
        collectionSlug: "docs",
        content: testContent,
        createdBy: authorId,
        fields: {},
        seoDescription: "Group delete SEO description",
        slug: "group-delete",
        status: CMS_ENTRY_STATUS.PUBLISHED,
        title: "Group Delete",
        tagIds: [],
      });

      const translation = await createCmsEntryTranslation({
        collectionSlug: "docs",
        slug: "group-delete",
        sourceLocale: DEFAULT_LOCALE,
        targetLocale: translationLocale!,
        createdBy: authorId,
        autoTranslate: false,
      });

      expect(translation.locale).toBe(translationLocale);
      await expect(countSearchRows(defaultEntry.id)).resolves.toBe(1);

      // Deleting the default-locale (anchor) row must take its translation sibling with it.
      await deleteCmsEntry({ id: defaultEntry.id });

      await expect(db.query.cmsEntryTable.findMany({
        where: { collection: "docs", slug: "group-delete" },
      })).resolves.toHaveLength(0);
      await expect(countSearchRows(defaultEntry.id)).resolves.toBe(0);
      await expect(countSearchRows(translation.id)).resolves.toBe(0);
    }
  );

  test.skipIf(!translationLocale)(
    "deleting a translation entry leaves the default-locale row intact",
    async () => {
      const authorId = await seedCmsAuthor();

      const defaultEntry = await createCmsEntry({
        collectionSlug: "docs",
        content: testContent,
        createdBy: authorId,
        fields: {},
        seoDescription: "Translation delete SEO description",
        slug: "translation-delete",
        status: CMS_ENTRY_STATUS.PUBLISHED,
        title: "Translation Delete",
        tagIds: [],
      });

      const translation = await createCmsEntryTranslation({
        collectionSlug: "docs",
        slug: "translation-delete",
        sourceLocale: DEFAULT_LOCALE,
        targetLocale: translationLocale!,
        createdBy: authorId,
        autoTranslate: false,
      });

      // Deleting a non-default locale drops just that row; the anchor group survives.
      await deleteCmsEntry({ id: translation.id });

      await expect(db.query.cmsEntryTable.findFirst({
        where: { id: translation.id },
      })).resolves.toBeUndefined();
      await expect(db.query.cmsEntryTable.findFirst({
        where: { id: defaultEntry.id },
      })).resolves.toEqual(expect.objectContaining({ id: defaultEntry.id }));
      await expect(countSearchRows(defaultEntry.id)).resolves.toBe(1);
      await expect(countSearchRows(translation.id)).resolves.toBe(0);
    }
  );
});
