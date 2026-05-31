/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test } from "vitest";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getDB } from "@/db";
import {
  cmsEntryMediaTable,
  cmsEntryTable,
  cmsEntryTagTable,
  cmsEntryVersionTable,
  cmsMediaTable,
  cmsTagTable,
  scheduledJobTable,
  userTable,
} from "@/db/schema";
import {
  getCmsCollectionCacheKey,
  getCmsCollectionCountCacheKey,
  getCmsEntryCacheKey,
} from "@/lib/cms/cms-cache-invalidation";
import {
  createCmsEntry,
  deleteCmsEntry,
  updateCmsEntry,
} from "@/lib/cms/entry";
import { SCHEDULED_JOB_TYPES } from "@/lib/scheduler/jobs";
import { CACHE_KEYS } from "@/utils/with-kv-cache";

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
  const keys = await env.NEXT_INC_CACHE_KV.list();
  await Promise.all(keys.keys.map((key) => env.NEXT_INC_CACHE_KV.delete(key.name)));
}

async function clearCmsRows(): Promise<void> {
  await env.NEXT_TAG_CACHE_D1.batch([
    env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM scheduled_job"),
    env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM cms_entry_search"),
    env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM cms_entry_media"),
    env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM cms_entry_tag"),
    env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM cms_entry_version"),
    env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM cms_entry"),
    env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM cms_media"),
    env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM cms_tag"),
    env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM user"),
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

async function seedInvalidationSentinels({
  collection,
  slug,
}: {
  collection: "docs";
  slug: string;
}): Promise<string[]> {
  const keys = [
    getCmsEntryCacheKey({ collectionSlug: collection, slug }),
    getCmsCollectionCacheKey({ collectionSlug: collection }),
    getCmsCollectionCountCacheKey({ collectionSlug: collection }),
    `${CACHE_KEYS.CMS_SEARCH}:${collection}:8:integration`,
    CACHE_KEYS.SITEMAP,
    CACHE_KEYS.CMS_TAGS,
  ];

  await Promise.all(keys.map((key) => env.NEXT_INC_CACHE_KV.put(key, "stale")));
  return keys;
}

async function countSearchRows(entryId: string): Promise<number> {
  const row = await env.NEXT_TAG_CACHE_D1
    .prepare("SELECT count(*) AS count FROM cms_entry_search WHERE entryId = ?")
    .bind(entryId)
    .first<{ count: number | string }>();

  return Number(row?.count ?? 0);
}

describe("CMS entry write path integration", () => {
  beforeEach(async () => {
    await clearKV();
    await clearCmsRows();
  });

  test("create, update, and delete keep D1, search, media, schedule, and cache state in sync", async () => {
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
      where: eq(scheduledJobTable.dedupeKey, `cms-entry:${createdEntry.id}`),
    })).resolves.toEqual(expect.objectContaining({
      payload: { entryId: createdEntry.id },
      runAt: publishedAt,
      type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
    }));
    await expect(db.query.cmsEntryTagTable.findMany({
      where: eq(cmsEntryTagTable.entryId, createdEntry.id),
    })).resolves.toHaveLength(1);

    const staleKeys = await seedInvalidationSentinels({
      collection: "docs",
      slug: createdEntry.slug,
    });

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
      where: eq(scheduledJobTable.dedupeKey, `cms-entry:${createdEntry.id}`),
    })).resolves.toHaveLength(0);
    await expect(db.query.cmsEntryMediaTable.findMany({
      where: eq(cmsEntryMediaTable.entryId, createdEntry.id),
    })).resolves.toEqual([
      expect.objectContaining({
        mediaId,
      }),
    ]);
    await expect(db.query.cmsEntryTagTable.findMany({
      where: eq(cmsEntryTagTable.entryId, createdEntry.id),
    })).resolves.toHaveLength(0);
    await expect(db.query.cmsEntryVersionTable.findMany({
      where: eq(cmsEntryVersionTable.entryId, createdEntry.id),
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

    for (const key of staleKeys) {
      await expect(env.NEXT_INC_CACHE_KV.get(key)).resolves.toBeNull();
    }

    await deleteCmsEntry({ id: createdEntry.id });

    await expect(db.query.cmsEntryTable.findFirst({
      where: eq(cmsEntryTable.id, createdEntry.id),
    })).resolves.toBeUndefined();
    await expect(countSearchRows(createdEntry.id)).resolves.toBe(0);
    await expect(db.query.cmsEntryMediaTable.findMany({
      where: eq(cmsEntryMediaTable.entryId, createdEntry.id),
    })).resolves.toHaveLength(0);
    await expect(db.query.scheduledJobTable.findMany({
      where: eq(scheduledJobTable.dedupeKey, `cms-entry:${createdEntry.id}`),
    })).resolves.toHaveLength(0);
  });
});
