import { afterEach, describe, expect, test, vi } from "vitest";

import { DEFAULT_LOCALE } from "@/i18n/config";
import {
  EMAIL_TEMPLATE_TYPES,
  SCHEDULED_JOB_TYPES,
} from "@/lib/scheduler/jobs";

const {
  publishScheduledCmsEntryIfDueMock,
  renderTransactionalEmailMock,
  sendTransactionalEmailNowMock,
  refreshTeamMemberSessionsMock,
  cancelTeamSubscriptionAsAdminMock,
} = vi.hoisted(() => ({
  publishScheduledCmsEntryIfDueMock: vi.fn(),
  renderTransactionalEmailMock: vi.fn(),
  sendTransactionalEmailNowMock: vi.fn(),
  refreshTeamMemberSessionsMock: vi.fn(),
  cancelTeamSubscriptionAsAdminMock: vi.fn(),
}));

vi.mock("@/lib/cms/cms-scheduled-publishing", () => ({
  publishScheduledCmsEntryIfDue: publishScheduledCmsEntryIfDueMock,
}));

vi.mock("@/utils/email", () => ({
  renderTransactionalEmail: renderTransactionalEmailMock,
  sendTransactionalEmailNow: sendTransactionalEmailNowMock,
}));

vi.mock("@/utils/kv-session", () => ({
  refreshTeamMemberSessions: refreshTeamMemberSessionsMock,
}));

vi.mock("@/lib/admin/team-billing-admin", () => ({
  cancelTeamSubscriptionAsAdmin: cancelTeamSubscriptionAsAdminMock,
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

  test("routes CMS publish jobs to the CMS publisher", async () => {
    await runScheduledJob({
      type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
      payload: { entryId: "entry-1" },
      runAt: "2026-05-29T10:00:00.000Z",
    });

    expect(publishScheduledCmsEntryIfDueMock).toHaveBeenCalledWith({ entryId: "entry-1" });
  });

  test("renders and sends transactional email jobs", async () => {
    const renderedEmail = {
      to: "user@example.com",
      subject: "Verify",
      html: "<p>Verify</p>",
      text: "Verify",
      type: EMAIL_TEMPLATE_TYPES.EMAIL_VERIFICATION,
    };
    renderTransactionalEmailMock.mockResolvedValue(renderedEmail);

    await runScheduledJob({
      type: SCHEDULED_JOB_TYPES.EMAIL_SEND,
      payload: {
        to: "user@example.com",
        template: EMAIL_TEMPLATE_TYPES.EMAIL_VERIFICATION,
        locale: DEFAULT_LOCALE,
        data: {
          verificationToken: "token-1",
          username: "Ada",
        },
      },
      runAt: "2026-05-29T10:00:00.000Z",
    });

    expect(renderTransactionalEmailMock).toHaveBeenCalledWith({
      to: "user@example.com",
      template: EMAIL_TEMPLATE_TYPES.EMAIL_VERIFICATION,
      locale: DEFAULT_LOCALE,
      data: {
        verificationToken: "token-1",
        username: "Ada",
      },
    });
    expect(sendTransactionalEmailNowMock).toHaveBeenCalledWith(renderedEmail);
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
