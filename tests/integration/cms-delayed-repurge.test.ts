/// <reference types="@cloudflare/vitest-plugin/types" />

import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getDB } from "@/db";
import { cmsEntryTable, userTable } from "@/db/schema";
import { cmsNavigationItemTable } from "@/db/schema";
import { BLOG_COLLECTION_SLUG } from "@/lib/blog-routing";
import {
  invalidateAllCmsCaches,
  invalidateCmsNavigationCaches,
  invalidateEntryAndCollection,
} from "@/lib/cms/cms-cache-invalidation";
import {
  CMS_ENTRY_CHANGES,
  CMS_INVALIDATION_SCOPES,
  SITE_HEADER_NAVIGATION_KEY,
} from "@/lib/cms/cms-invalidation-scopes";
import { DOCS_BASE_PATH, DOCS_SLUG } from "@/lib/cms/docs-config";
import { createCmsEntry, deleteCmsEntry, updateCmsEntry } from "@/lib/cms/entry";
import { createCmsTag } from "@/lib/cms/tags";
import {
  createScheduledQueueMessage,
  SCHEDULED_JOB_TYPES,
  type ScheduledQueueMessage,
} from "@/lib/scheduler/jobs";
import { handleSchedulerQueue } from "@/lib/scheduler/worker";

const db = getDB();
const dayInMs = 24 * 60 * 60 * 1000;
const ENTRY_SLUG = "delayed-repurge-entry";

interface SentMessage {
  body: ScheduledQueueMessage;
  delaySeconds?: number;
}

function spyOnQueueBatches() {
  return vi.spyOn(env.SCHEDULER_QUEUE, "sendBatch").mockResolvedValue(undefined as never);
}

function sentMessages(sendBatch: ReturnType<typeof spyOnQueueBatches>): SentMessage[] {
  return sendBatch.mock.calls.flatMap(([messages]) => Array.from(messages) as SentMessage[]);
}

function repurgeMessages(sendBatch: ReturnType<typeof spyOnQueueBatches>): SentMessage[] {
  return sentMessages(sendBatch).filter(
    ({ body }) => body.type === SCHEDULED_JOB_TYPES.CMS_REPURGE,
  );
}

// The consumer reads only the body, the attempt count, and the two settle calls.
function queueBatch(body: ScheduledQueueMessage) {
  const message = {
    id: "message-1",
    attempts: 1,
    body,
    timestamp: new Date(),
    ack: vi.fn(),
    retry: vi.fn(),
  };

  return {
    message,
    batch: {
      queue: "scheduler",
      messages: [message],
      ackAll: vi.fn(),
      retryAll: vi.fn(),
    } as unknown as MessageBatch<ScheduledQueueMessage>,
  };
}

async function clearRows(): Promise<void> {
  await env.D1_DB.batch([
    env.D1_DB.prepare("DELETE FROM scheduled_job"),
    env.D1_DB.prepare("DELETE FROM cms_navigation_item"),
    env.D1_DB.prepare("DELETE FROM cms_tag"),
    env.D1_DB.prepare("DELETE FROM cms_entry_search"),
    env.D1_DB.prepare("DELETE FROM cms_entry_tag"),
    env.D1_DB.prepare("DELETE FROM cms_entry_version"),
    env.D1_DB.prepare("DELETE FROM cms_entry"),
    env.D1_DB.prepare("DELETE FROM user"),
  ]);
}

async function insertAuthor(): Promise<string> {
  const [author] = await db
    .insert(userTable)
    .values({ id: "repurge-author", email: "repurge-author@example.com" })
    .returning({ id: userTable.id });

  return author.id;
}

async function insertPublishedBlogPost({
  authorId,
  slug,
}: {
  authorId: string;
  slug: string;
}): Promise<void> {
  await createCmsEntry({
    collectionSlug: BLOG_COLLECTION_SLUG,
    content: { type: "doc", content: [] },
    createdBy: authorId,
    fields: {},
    slug,
    status: CMS_ENTRY_STATUS.PUBLISHED,
    title: slug,
  });
}

describe("CMS delayed repurge", () => {
  beforeEach(async () => {
    await clearRows();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("an entry write queues one delayed repurge that carries only the target of the write", async () => {
    const sendBatch = spyOnQueueBatches();

    await invalidateEntryAndCollection({ collectionSlug: DOCS_SLUG, slug: ENTRY_SLUG, warm: true });

    const [message, ...rest] = repurgeMessages(sendBatch);
    expect(rest).toHaveLength(0);
    expect(message?.delaySeconds).toBeGreaterThan(0);
    expect(message?.body.payload).toEqual({
      entries: [{ collection: DOCS_SLUG, slug: ENTRY_SLUG }],
      entryChange: CMS_ENTRY_CHANGES.CONTENT,
      knownPagePathnames: [],
      navigationKeys: [],
      scopes: [],
    });
    expect(Date.parse(message?.body.runAt ?? "")).toBeGreaterThan(Date.now());
  });

  test("a scheduled publish from the queue also queues the delayed repurge", async () => {
    const [author] = await db
      .insert(userTable)
      .values({ id: "repurge-author", email: "repurge-author@example.com" })
      .returning({ id: userTable.id });
    const entry = await createCmsEntry({
      collectionSlug: DOCS_SLUG,
      content: { type: "doc", content: [] },
      createdBy: author.id,
      fields: {},
      publishedAt: new Date(Date.now() + 3 * dayInMs),
      slug: ENTRY_SLUG,
      status: CMS_ENTRY_STATUS.SCHEDULED,
      title: "Delayed repurge entry",
    });
    // Due now, so the consumer publishes instead of deferring.
    await db
      .update(cmsEntryTable)
      .set({ publishedAt: new Date(Date.now() - 1000) })
      .where(eq(cmsEntryTable.id, entry.id));

    const sendBatch = spyOnQueueBatches();
    const { batch, message } = queueBatch(createScheduledQueueMessage({
      type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
      payload: { entryId: entry.id },
      runAt: new Date(Date.now() - 1000),
    }));

    await handleSchedulerQueue(batch);

    expect(message.ack).toHaveBeenCalledOnce();
    expect(repurgeMessages(sendBatch).map(({ body }) => body.payload)).toEqual([
      {
        entries: [{ collection: DOCS_SLUG, slug: ENTRY_SLUG }],
        entryChange: CMS_ENTRY_CHANGES.CONTENT,
        knownPagePathnames: [],
        navigationKeys: [],
        scopes: [],
      },
    ]);
  });

  test("the delayed repurge runs once and queues nothing more", async () => {
    const sendBatch = spyOnQueueBatches();
    const send = vi.spyOn(env.SCHEDULER_QUEUE, "send").mockResolvedValue(undefined as never);
    const { batch, message } = queueBatch(createScheduledQueueMessage({
      type: SCHEDULED_JOB_TYPES.CMS_REPURGE,
      payload: { entries: [{ collection: DOCS_SLUG, slug: ENTRY_SLUG }] },
      runAt: new Date(Date.now() - 1000),
    }));

    await handleSchedulerQueue(batch);

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(sendBatch).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  test("a tag create with no entry queues a delayed repurge of the tag catalog", async () => {
    const authorId = await insertAuthor();
    const sendBatch = spyOnQueueBatches();

    await createCmsTag({ name: "Repurge tag", slug: "repurge-tag", createdBy: authorId });

    expect(repurgeMessages(sendBatch).map(({ body }) => body.payload)).toEqual([
      {
        entries: [],
        entryChange: CMS_ENTRY_CHANGES.TAGS,
        knownPagePathnames: [],
        navigationKeys: [],
        scopes: [CMS_INVALIDATION_SCOPES.TAG_CATALOG],
      },
    ]);
  });

  test("a navigation save and a full CMS clear each queue a delayed repurge by fixed names", async () => {
    const sendBatch = spyOnQueueBatches();

    // A save that keeps the page set cannot flip the header docs link.
    await invalidateCmsNavigationCaches({
      navigationKey: DOCS_SLUG,
      pageChange: { addedItems: 0, removedItems: 0 },
    });
    await invalidateAllCmsCaches();

    expect(repurgeMessages(sendBatch).map(({ body }) => body.payload)).toEqual([
      {
        entries: [],
        entryChange: CMS_ENTRY_CHANGES.CONTENT,
        knownPagePathnames: [],
        navigationKeys: [DOCS_SLUG],
        scopes: [],
      },
      {
        entries: [],
        entryChange: CMS_ENTRY_CHANGES.CONTENT,
        knownPagePathnames: [],
        navigationKeys: [],
        scopes: [CMS_INVALIDATION_SCOPES.ALL_CMS],
      },
    ]);
  });

  // The header shows the blog link only while a post is published, so the first one flips it.
  test("the first published blog post purges the header pages, and a later one does not", async () => {
    const authorId = await insertAuthor();
    const sendBatch = spyOnQueueBatches();

    // Each create runs the entry write pipeline itself.
    await insertPublishedBlogPost({ authorId, slug: "first-post" });
    await insertPublishedBlogPost({ authorId, slug: "second-post" });

    expect(repurgeMessages(sendBatch).map(({ body }) => (body.payload as { scopes?: string[] }).scopes)).toEqual([
      [CMS_INVALIDATION_SCOPES.SITE_HEADER],
      [],
    ]);
  });

  // The header shows the docs link while a docs page is live, so the first live page flips it.
  test.skipIf(DOCS_SLUG !== SITE_HEADER_NAVIGATION_KEY)(
    "only the first and the last live docs page purge the header pages",
    async () => {
      const authorId = await insertAuthor();
      const [first, second] = await Promise.all(["first-doc", "second-doc"].map((slug) => createCmsEntry({
        collectionSlug: DOCS_SLUG,
        content: { type: "doc", content: [] },
        createdBy: authorId,
        fields: {},
        slug,
        status: CMS_ENTRY_STATUS.DRAFT,
        title: slug,
      })));
      await db.insert(cmsNavigationItemTable).values([first, second].map((entry, sortOrder) => ({
        navigationKey: DOCS_SLUG,
        nodeType: "page" as const,
        title: entry.title,
        entryId: entry.id,
        slugSegment: entry.slug,
        resolvedPath: `${DOCS_BASE_PATH}/${entry.slug}`,
        sortOrder,
      })));
      const sendBatch = spyOnQueueBatches();

      // The first live page makes the docs link appear.
      await updateCmsEntry({ id: first.id, status: CMS_ENTRY_STATUS.PUBLISHED });
      // The first page was live before and after this publish.
      await updateCmsEntry({ id: second.id, status: CMS_ENTRY_STATUS.PUBLISHED });
      // A content edit changes no publish state.
      await updateCmsEntry({ id: first.id, title: "First doc, edited" });
      // The second page stays live.
      await updateCmsEntry({ id: first.id, status: CMS_ENTRY_STATUS.DRAFT });
      // No live page is left, so the docs link goes away.
      await deleteCmsEntry({ id: second.id });

      expect(repurgeMessages(sendBatch).map(({ body }) => (body.payload as { scopes?: string[] }).scopes)).toEqual([
        [CMS_INVALIDATION_SCOPES.SITE_HEADER],
        [],
        [],
        [],
        [CMS_INVALIDATION_SCOPES.SITE_HEADER],
      ]);
    },
  );

  test("a delayed repurge that names only scopes runs once and queues nothing more", async () => {
    const sendBatch = spyOnQueueBatches();
    const { batch, message } = queueBatch(createScheduledQueueMessage({
      type: SCHEDULED_JOB_TYPES.CMS_REPURGE,
      payload: {
        navigationKeys: [DOCS_SLUG],
        scopes: [CMS_INVALIDATION_SCOPES.SITE_HEADER, CMS_INVALIDATION_SCOPES.TAG_CATALOG],
      },
      runAt: new Date(Date.now() - 1000),
    }));

    await handleSchedulerQueue(batch);

    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
    expect(sendBatch).not.toHaveBeenCalled();
  });

  // The navigation row cascades away with the entry, so the purge must name the page it read first.
  test("a docs entry delete still deletes the stored page of its navigation path", async () => {
    vi.stubGlobal("__MARKDOWN_BUILD_ID__", "test-build-id");
    const authorId = await insertAuthor();
    const entry = await createCmsEntry({
      collectionSlug: DOCS_SLUG,
      content: { type: "doc", content: [] },
      createdBy: authorId,
      fields: {},
      slug: ENTRY_SLUG,
      status: CMS_ENTRY_STATUS.PUBLISHED,
      title: "Deleted docs entry",
    });
    const resolvedPath = `${DOCS_BASE_PATH}/guides/${ENTRY_SLUG}`;
    await db.insert(cmsNavigationItemTable).values({
      navigationKey: DOCS_SLUG,
      nodeType: "page",
      title: "Deleted docs entry",
      entryId: entry.id,
      slugSegment: ENTRY_SLUG,
      resolvedPath,
      sortOrder: 0,
    });
    spyOnQueueBatches();
    // The DOM lib types `caches` without the Workers-only `default`, which workerd provides here.
    const edgeCache = (caches as CacheStorage & { default: Cache }).default;
    const deleteSpy = vi.spyOn(edgeCache, "delete");

    await deleteCmsEntry({ id: entry.id });

    const deletedKeys = deleteSpy.mock.calls.map(([key]) => String(key));
    expect(deletedKeys.some((key) => key.endsWith(`/__edge-html/test-build-id${resolvedPath}`))).toBe(true);
  });
});
