/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import type { CollectionsUnion } from "@/../cms.config";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getDB } from "@/db";
import { cmsEntryTable, userTable } from "@/db/schema";
import { BLOG_COLLECTION_SLUG } from "@/lib/blog-routing";
import {
  getCmsEntryRefsRenderingAuthor,
  invalidateCmsAuthorAfterUserWrite,
} from "@/lib/cms/cms-author-cache-invalidation";
import type { CmsAuthorFields } from "@/lib/cms/cms-author-fields";
import { DOCS_SLUG } from "@/lib/cms/docs-config";
import { createCmsEntry } from "@/lib/cms/entry";
import type { CmsEntryStatus } from "@/types/cms";
import { SCHEDULED_JOB_TYPES, type ScheduledQueueMessage } from "@/lib/scheduler/jobs";

const db = getDB();
const AUTHOR_ID = "author-purge-author";
const OTHER_AUTHOR_ID = "author-purge-other";
const author: CmsAuthorFields = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: "author-purge@example.com",
  avatar: null,
};

async function clearRows(): Promise<void> {
  await env.D1_DB.batch([
    env.D1_DB.prepare("DELETE FROM scheduled_job"),
    env.D1_DB.prepare("DELETE FROM cms_entry_search"),
    env.D1_DB.prepare("DELETE FROM cms_entry_tag"),
    env.D1_DB.prepare("DELETE FROM cms_entry_version"),
    env.D1_DB.prepare("DELETE FROM cms_entry"),
    env.D1_DB.prepare("DELETE FROM user"),
  ]);
}

async function createEntry({ collectionSlug, slug, status, createdBy }: {
  collectionSlug: CollectionsUnion;
  slug: string;
  status: CmsEntryStatus;
  createdBy: string;
}): Promise<void> {
  await createCmsEntry({
    collectionSlug,
    content: { type: "doc", content: [] },
    createdBy,
    fields: {},
    slug,
    status,
    title: slug,
  });
}

function spyOnQueueBatches() {
  return vi.spyOn(env.SCHEDULER_QUEUE, "sendBatch").mockResolvedValue(undefined as never);
}

// The delayed repurge carries the exact entry refs that the purge named.
function repurgedEntries(sendBatch: ReturnType<typeof spyOnQueueBatches>): unknown[] {
  return sendBatch.mock.calls
    .flatMap(([messages]) => Array.from(messages) as { body: ScheduledQueueMessage }[])
    .filter(({ body }) => body.type === SCHEDULED_JOB_TYPES.CMS_REPURGE)
    .map(({ body }) => body.payload);
}

describe("CMS author purge after a user write", () => {
  beforeEach(async () => {
    await clearRows();
    await db.insert(userTable).values([
      { id: AUTHOR_ID, ...author },
      { id: OTHER_AUTHOR_ID, email: "author-purge-other@example.com" },
    ]);
    await createEntry({
      collectionSlug: BLOG_COLLECTION_SLUG,
      slug: "author-blog-post",
      status: CMS_ENTRY_STATUS.PUBLISHED,
      createdBy: AUTHOR_ID,
    });
    await createEntry({
      collectionSlug: DOCS_SLUG,
      slug: "author-docs-page",
      status: CMS_ENTRY_STATUS.PUBLISHED,
      createdBy: AUTHOR_ID,
    });
    await createEntry({
      collectionSlug: BLOG_COLLECTION_SLUG,
      slug: "author-draft-post",
      status: CMS_ENTRY_STATUS.DRAFT,
      createdBy: AUTHOR_ID,
    });
    await createEntry({
      collectionSlug: BLOG_COLLECTION_SLUG,
      slug: "other-blog-post",
      status: CMS_ENTRY_STATUS.PUBLISHED,
      createdBy: OTHER_AUTHOR_ID,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("selects only the published entries of that author, in every collection", async () => {
    const entries = await getCmsEntryRefsRenderingAuthor({ userId: AUTHOR_ID });

    expect(entries).toHaveLength(2);
    expect(entries).toEqual(expect.arrayContaining([
      { collection: BLOG_COLLECTION_SLUG, slug: "author-blog-post" },
      { collection: DOCS_SLUG, slug: "author-docs-page" },
    ]));
  });

  test("a name change purges the entries that render the author", async () => {
    const sendBatch = spyOnQueueBatches();

    await invalidateCmsAuthorAfterUserWrite({
      userId: AUTHOR_ID,
      before: author,
      after: { ...author, firstName: "Augusta" },
    });

    const [payload, ...rest] = repurgedEntries(sendBatch);
    expect(rest).toHaveLength(0);
    expect((payload as { entries: unknown[] }).entries).toEqual(expect.arrayContaining([
      { collection: BLOG_COLLECTION_SLUG, slug: "author-blog-post" },
      { collection: DOCS_SLUG, slug: "author-docs-page" },
    ]));
    expect((payload as { entries: unknown[] }).entries).toHaveLength(2);
  });

  // Every published post is by this author, so a count check would see the whole blog in the write.
  test("an avatar change on a single-author blog does not purge the site header", async () => {
    await db.delete(cmsEntryTable).where(eq(cmsEntryTable.createdBy, OTHER_AUTHOR_ID));
    const sendBatch = spyOnQueueBatches();

    await invalidateCmsAuthorAfterUserWrite({
      userId: AUTHOR_ID,
      before: author,
      after: { ...author, avatar: "https://example.com/avatar.png" },
    });

    expect(repurgedEntries(sendBatch)).toEqual([expect.objectContaining({ scopes: [] })]);
  });

  test("purges nothing when no rendered field changed", async () => {
    const sendBatch = spyOnQueueBatches();

    await invalidateCmsAuthorAfterUserWrite({ userId: AUTHOR_ID, before: author, after: { ...author } });

    expect(repurgedEntries(sendBatch)).toHaveLength(0);
  });

  test("purges nothing for a user with no published entry", async () => {
    const sendBatch = spyOnQueueBatches();

    await invalidateCmsAuthorAfterUserWrite({
      userId: "author-purge-nobody",
      before: author,
      after: { ...author, avatar: "https://example.com/avatar.png" },
    });

    expect(repurgedEntries(sendBatch)).toHaveLength(0);
  });
});
