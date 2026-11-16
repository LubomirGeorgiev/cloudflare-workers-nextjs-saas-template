import { afterEach, describe, expect, test, vi } from "vitest";

import { collectionSlugs } from "@/../cms.config";
import { CMS_ENTRY_CHANGES, CMS_INVALIDATION_SCOPES } from "@/lib/cms/cms-invalidation-scopes";
import {
  CMS_REPURGE_ENTRIES_PER_MESSAGE,
  CMS_REPURGE_PATHNAME_MAX_LENGTH,
  CMS_REPURGE_PATHNAMES_PER_MESSAGE,
  cmsRepurgeJobPayloadSchema,
  SCHEDULED_JOB_TYPES,
} from "@/lib/scheduler/jobs";
import { v } from "@/lib/validation";

const { sendBatchMock, scheduleJobMock } = vi.hoisted(() => ({
  sendBatchMock: vi.fn(async (__messages: Array<{ body: { payload: unknown } }>) => undefined),
  scheduleJobMock: vi.fn(async () => "queued" as const),
}));

vi.mock("server-only", () => ({}));

vi.mock("cloudflare:workers", () => ({
  env: { SCHEDULER_QUEUE: { send: vi.fn(), sendBatch: sendBatchMock } },
}));

vi.mock("@/lib/scheduler/scheduler", () => ({ scheduleJob: scheduleJobMock }));

const { enqueueBillingCancelSubscription, enqueueCmsRepurge, enqueueEuWithdrawalResume } = await import("./enqueue");

function sentPayloads() {
  return sendBatchMock.mock.calls.flatMap(([messages]) => messages.map(({ body }) => body.payload));
}

describe("enqueueBillingCancelSubscription", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // A lost retry keeps charging a banned user, so the job must survive a failed queue send.
  test("schedules a durable job, one per subscription", async () => {
    await enqueueBillingCancelSubscription({ teamId: "team_1", subscriptionId: "sub_1" });

    expect(scheduleJobMock).toHaveBeenCalledWith(expect.objectContaining({
      type: SCHEDULED_JOB_TYPES.BILLING_CANCEL_SUBSCRIPTION,
      dedupeKey: expect.stringContaining("sub_1"),
      payload: { teamId: "team_1", subscriptionId: "sub_1" },
      durable: true,
    }));
  });
});

describe("enqueueEuWithdrawalResume", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // The withdrawal is recorded on Stripe, and nothing else finishes its refund.
  test("schedules a durable job at the given time", async () => {
    const runAt = new Date("2026-03-04T10:00:00.000Z");

    await enqueueEuWithdrawalResume({ teamId: "team_1", subscriptionId: "sub_1", runAt });

    expect(scheduleJobMock).toHaveBeenCalledWith(expect.objectContaining({
      type: SCHEDULED_JOB_TYPES.BILLING_EU_WITHDRAWAL_RESUME,
      dedupeKey: expect.stringContaining("sub_1"),
      payload: { teamId: "team_1", subscriptionId: "sub_1" },
      runAt,
      durable: true,
    }));
  });

  // Two overlapping withdrawals in a queue outage: the second save must not replace the first job,
  // which may be the one that `eu_resume_at` names.
  test("gives each run time of one subscription its own job key", async () => {
    const first = new Date("2026-03-04T10:00:00.000Z");
    const second = new Date("2026-03-04T10:00:05.000Z");

    await enqueueEuWithdrawalResume({ teamId: "team_1", subscriptionId: "sub_1", runAt: first });
    await enqueueEuWithdrawalResume({ teamId: "team_1", subscriptionId: "sub_1", runAt: second });

    const keys = scheduleJobMock.mock.calls.map((call) => (call as unknown as [{ dedupeKey: string }])[0].dedupeKey);
    expect(new Set(keys).size).toBe(2);
  });
});

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
