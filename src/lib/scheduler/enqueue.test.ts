import { afterEach, describe, expect, test, vi } from "vitest";

import { collectionSlugs } from "@/../cms.config";
import { CMS_ENTRY_CHANGES, CMS_INVALIDATION_SCOPES } from "@/lib/cms/cms-invalidation-scopes";
import {
  CMS_REPURGE_ENTRIES_PER_MESSAGE,
  CMS_REPURGE_PATHNAME_MAX_LENGTH,
  CMS_REPURGE_PATHNAMES_PER_MESSAGE,
  cmsRepurgeJobPayloadSchema,
} from "@/lib/scheduler/jobs";
import { v } from "@/lib/validation";

const { sendBatchMock } = vi.hoisted(() => ({
  sendBatchMock: vi.fn(async (__messages: Array<{ body: { payload: unknown } }>) => undefined),
}));

vi.mock("server-only", () => ({}));

vi.mock("cloudflare:workers", () => ({
  env: { SCHEDULER_QUEUE: { send: vi.fn(), sendBatch: sendBatchMock } },
}));

const { enqueueCmsRepurge } = await import("./enqueue");

function sentPayloads() {
  return sendBatchMock.mock.calls.flatMap(([messages]) => messages.map(({ body }) => body.payload));
}

describe("enqueueCmsRepurge", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("splits entries and pages into valid messages, with the scopes on the first one", async () => {
    const entries = Array.from({ length: CMS_REPURGE_ENTRIES_PER_MESSAGE + 1 }, (__, index) => ({
      collection: collectionSlugs[0],
      slug: `entry-${index}`,
    }));
    const knownPagePathnames = Array.from(
      { length: CMS_REPURGE_PATHNAMES_PER_MESSAGE + 1 },
      (__, index) => `/page-${index}`,
    );

    await enqueueCmsRepurge({
      entries,
      entryChange: CMS_ENTRY_CHANGES.TAGS,
      knownPagePathnames,
      navigationKeys: [],
      scopes: [CMS_INVALIDATION_SCOPES.TAG_CATALOG],
      delaySeconds: 1,
    });

    const payloads = sentPayloads().map((payload) => v.parse(cmsRepurgeJobPayloadSchema, payload));

    expect(payloads).toHaveLength(2);
    expect(payloads[0]?.scopes).toEqual([CMS_INVALIDATION_SCOPES.TAG_CATALOG]);
    expect(payloads.slice(1).every(({ scopes }) => scopes.length === 0)).toBe(true);
    expect(payloads.flatMap((payload) => payload.entries)).toEqual(entries);
    expect(payloads.flatMap((payload) => payload.knownPagePathnames)).toEqual(knownPagePathnames);
    // Every message with entries says what changed in them.
    for (const payload of payloads.filter(({ entries: part }) => part.length > 0)) {
      expect(payload.entryChange).toBe(CMS_ENTRY_CHANGES.TAGS);
    }
  });

  test("drops a page path too long for a message, and still sends the rest", async () => {
    await enqueueCmsRepurge({
      entries: [],
      entryChange: CMS_ENTRY_CHANGES.CONTENT,
      knownPagePathnames: [`/${"a".repeat(CMS_REPURGE_PATHNAME_MAX_LENGTH)}`, "/kept"],
      navigationKeys: [],
      scopes: [],
      delaySeconds: 1,
    });

    const payloads = sentPayloads().map((payload) => v.parse(cmsRepurgeJobPayloadSchema, payload));

    expect(payloads.flatMap((payload) => payload.knownPagePathnames)).toEqual(["/kept"]);
  });
});
