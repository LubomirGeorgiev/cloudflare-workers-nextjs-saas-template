import { afterEach, describe, expect, test, vi } from "vitest";

import { cmsNavigationKeys, collectionSlugs } from "@/../cms.config";
import {
  CMS_CACHE_PURGE_OK,
  CMS_PURGE_STATUS,
  type CmsCachePurgeOutcome,
} from "@/constants/cache-purge";
import { CMS_ENTRY_CHANGES, CMS_INVALIDATION_SCOPE_VALUES } from "@/lib/cms/cms-invalidation-scopes";
import { DEFAULT_LOCALE } from "@/i18n/config";
import {
  EMAIL_TEMPLATE_TYPES,
  SCHEDULED_JOB_TYPES,
} from "@/lib/scheduler/jobs";

const {
  publishScheduledCmsEntryIfDueMock,
  repurgeCmsCachesMock,
  sendEmailJobMock,
  refreshTeamMemberSessionsMock,
  cancelTeamSubscriptionAsAdminMock,
  resumeWithdrawalMock,
} = vi.hoisted(() => ({
  publishScheduledCmsEntryIfDueMock: vi.fn(),
  // Both purges went through, unless a test says otherwise.
  repurgeCmsCachesMock: vi.fn(async (): Promise<CmsCachePurgeOutcome> => ({ zone: "ok", workersCache: "ok" })),
  sendEmailJobMock: vi.fn(),
  refreshTeamMemberSessionsMock: vi.fn(),
  cancelTeamSubscriptionAsAdminMock: vi.fn(),
  resumeWithdrawalMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/cms/cms-scheduled-publishing", () => ({
  publishScheduledCmsEntryIfDue: publishScheduledCmsEntryIfDueMock,
}));

vi.mock("@/lib/cms/cms-cache-invalidation", () => ({
  getKnownCmsCollectionSlug: (collectionSlug: string) => collectionSlug,
  repurgeCmsCaches: repurgeCmsCachesMock,
}));

vi.mock("@/utils/email", () => ({
  sendEmailJob: sendEmailJobMock,
}));

vi.mock("@/utils/kv-session", () => ({
  refreshTeamMemberSessions: refreshTeamMemberSessionsMock,
}));

vi.mock("@/lib/admin/team-billing-admin", () => ({
  cancelTeamSubscriptionAsAdmin: cancelTeamSubscriptionAsAdminMock,
}));

vi.mock("@/lib/billing/eu-withdrawal", () => ({
  resumeWithdrawal: resumeWithdrawalMock,
}));

const { runScheduledJob } = await import("@/lib/scheduler/job-handlers");

describe("scheduled job handlers", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("routes a billing cancellation retry to the shared staff cancel", async () => {
    await runScheduledJob({
      type: SCHEDULED_JOB_TYPES.BILLING_CANCEL_SUBSCRIPTION,
      payload: { teamId: "team-1", subscriptionId: "sub_1" },
      runAt: "2026-05-29T10:00:00.000Z",
    });

    expect(cancelTeamSubscriptionAsAdminMock).toHaveBeenCalledWith(
      expect.objectContaining({ teamId: "team-1", subscriptionId: "sub_1" }),
    );
  });

  test("routes an EU withdrawal resume to the withdrawal service", async () => {
    await runScheduledJob({
      type: SCHEDULED_JOB_TYPES.BILLING_EU_WITHDRAWAL_RESUME,
      payload: { teamId: "team-1", subscriptionId: "sub_1" },
      runAt: "2026-05-29T10:00:00.000Z",
    });

    expect(resumeWithdrawalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        teamId: "team-1",
        subscriptionId: "sub_1",
        // The job's own run time decides whether it still owns the resume chain.
        scheduledFor: "2026-05-29T10:00:00.000Z",
        now: expect.any(Date),
      }),
    );
  });

  test("routes CMS publish jobs to the CMS publisher", async () => {
    await runScheduledJob({
      type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
      payload: { entryId: "entry-1" },
      runAt: "2026-05-29T10:00:00.000Z",
    });

    expect(publishScheduledCmsEntryIfDueMock).toHaveBeenCalledWith({ entryId: "entry-1" });
  });

  test("routes a CMS repurge job to the delayed purge, never to the publisher", async () => {
    const entries = [{ collection: collectionSlugs[0], slug: "launch-notes" }];

    await runScheduledJob({
      type: SCHEDULED_JOB_TYPES.CMS_REPURGE,
      payload: { entries },
      runAt: "2026-05-29T10:00:00.000Z",
    });

    expect(repurgeCmsCachesMock).toHaveBeenCalledWith({
      entries,
      entryChange: CMS_ENTRY_CHANGES.CONTENT,
      knownPagePathnames: [],
      navigationKeys: [],
      scopes: [],
    });
    expect(publishScheduledCmsEntryIfDueMock).not.toHaveBeenCalled();
  });

  // A tag create, a navigation save, or a full clear names no entry, only fixed scope names.
  test("routes a CMS repurge job that names only navigations and scopes", async () => {
    const navigationKeys = [...cmsNavigationKeys];
    const scopes = [...CMS_INVALIDATION_SCOPE_VALUES];

    await runScheduledJob({
      type: SCHEDULED_JOB_TYPES.CMS_REPURGE,
      payload: { navigationKeys, scopes },
      runAt: "2026-05-29T10:00:00.000Z",
    });

    expect(repurgeCmsCachesMock).toHaveBeenCalledWith({
      entries: [],
      entryChange: CMS_ENTRY_CHANGES.CONTENT,
      knownPagePathnames: [],
      navigationKeys,
      scopes,
    });
  });

  test("routes the entry change and the pages of a CMS repurge job", async () => {
    const entries = [{ collection: collectionSlugs[0], slug: "launch-notes" }];
    const knownPagePathnames = ["/old-page"];

    await runScheduledJob({
      type: SCHEDULED_JOB_TYPES.CMS_REPURGE,
      payload: { entries, entryChange: CMS_ENTRY_CHANGES.TAGS, knownPagePathnames },
      runAt: "2026-05-29T10:00:00.000Z",
    });

    expect(repurgeCmsCachesMock).toHaveBeenCalledWith(expect.objectContaining({
      entries,
      entryChange: CMS_ENTRY_CHANGES.TAGS,
      knownPagePathnames,
    }));
  });

  // A throw makes the consumer retry the message, up to the queue's `max_retries`.
  test("rejects a CMS repurge job whose purge failed, so the queue retries it", async () => {
    repurgeCmsCachesMock.mockResolvedValueOnce({
      ...CMS_CACHE_PURGE_OK,
      workersCache: CMS_PURGE_STATUS.FAILED,
    });

    await expect(runScheduledJob({
      type: SCHEDULED_JOB_TYPES.CMS_REPURGE,
      payload: { entries: [{ collection: collectionSlugs[0], slug: "launch-notes" }] },
      runAt: "2026-05-29T10:00:00.000Z",
    })).rejects.toThrow();
  });

  // A missing zone config never heals, so a retry would only repeat the same purge.
  test("acks a CMS repurge job whose zone purge is not configured", async () => {
    repurgeCmsCachesMock.mockResolvedValueOnce({
      ...CMS_CACHE_PURGE_OK,
      zone: CMS_PURGE_STATUS.UNCONFIGURED,
    });

    await expect(runScheduledJob({
      type: SCHEDULED_JOB_TYPES.CMS_REPURGE,
      payload: { entries: [{ collection: collectionSlugs[0], slug: "launch-notes" }] },
      runAt: "2026-05-29T10:00:00.000Z",
    })).resolves.toBeUndefined();
  });

  test("rejects a CMS repurge job with an unknown scope", async () => {
    await expect(runScheduledJob({
      type: SCHEDULED_JOB_TYPES.CMS_REPURGE,
      payload: { scopes: ["/any/path" as never] },
      runAt: "2026-05-29T10:00:00.000Z",
    })).rejects.toThrow();

    expect(repurgeCmsCachesMock).not.toHaveBeenCalled();
  });

  test("rejects a CMS repurge job that names nothing", async () => {
    await expect(runScheduledJob({
      type: SCHEDULED_JOB_TYPES.CMS_REPURGE,
      payload: { entries: [] },
      runAt: "2026-05-29T10:00:00.000Z",
    })).rejects.toThrow();

    expect(repurgeCmsCachesMock).not.toHaveBeenCalled();
  });

  test("routes transactional email jobs to the idempotent email send", async () => {
    const payload = {
      to: "user@example.com",
      template: EMAIL_TEMPLATE_TYPES.EMAIL_VERIFICATION,
      locale: DEFAULT_LOCALE,
      data: {
        verificationToken: "token-1",
        username: "Ada",
      },
    };

    await runScheduledJob({
      type: SCHEDULED_JOB_TYPES.EMAIL_SEND,
      payload,
      runAt: "2026-05-29T10:00:00.000Z",
      dedupeKey: "email-row-1",
    });

    expect(sendEmailJobMock).toHaveBeenCalledWith({ payload, dedupeKey: "email-row-1" });
  });

  test("routes team sessions-refresh jobs to the session refresher", async () => {
    await runScheduledJob({
      type: SCHEDULED_JOB_TYPES.TEAM_SESSIONS_REFRESH,
      payload: { teamId: "team-1" },
      runAt: "2026-05-29T10:00:00.000Z",
    });

    expect(refreshTeamMemberSessionsMock).toHaveBeenCalledWith("team-1");
  });

  test("rejects invalid payloads before running downstream handlers", async () => {
    await expect(runScheduledJob({
      type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
      payload: { entryId: "" },
      runAt: "2026-05-29T10:00:00.000Z",
    })).rejects.toThrow();

    expect(publishScheduledCmsEntryIfDueMock).not.toHaveBeenCalled();
  });
});
