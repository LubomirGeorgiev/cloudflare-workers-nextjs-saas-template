import { afterEach, describe, expect, test, vi } from "vitest";

import {
  EMAIL_TEMPLATE_TYPES,
  SCHEDULED_JOB_TYPES,
} from "@/lib/scheduler/jobs";

const {
  processExpiredCreditTransactionIfDueMock,
  publishScheduledCmsEntryIfDueMock,
  refreshScheduledUserCreditsIfDueMock,
  renderTransactionalEmailMock,
  sendTransactionalEmailNowMock,
} = vi.hoisted(() => ({
  processExpiredCreditTransactionIfDueMock: vi.fn(),
  publishScheduledCmsEntryIfDueMock: vi.fn(),
  refreshScheduledUserCreditsIfDueMock: vi.fn(),
  renderTransactionalEmailMock: vi.fn(),
  sendTransactionalEmailNowMock: vi.fn(),
}));

vi.mock("@/lib/cms/cms-scheduled-publishing", () => ({
  publishScheduledCmsEntryIfDue: publishScheduledCmsEntryIfDueMock,
}));

vi.mock("@/utils/credit-scheduler", () => ({
  processExpiredCreditTransactionIfDue: processExpiredCreditTransactionIfDueMock,
}));

vi.mock("@/utils/credit-refresh-job", () => ({
  refreshScheduledUserCreditsIfDue: refreshScheduledUserCreditsIfDueMock,
}));

vi.mock("@/utils/email", () => ({
  renderTransactionalEmail: renderTransactionalEmailMock,
  sendTransactionalEmailNow: sendTransactionalEmailNowMock,
}));

const { runScheduledJob } = await import("@/lib/scheduler/job-handlers");

describe("scheduled job handlers", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("routes CMS publish jobs to the CMS publisher", async () => {
    await runScheduledJob({
      type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
      payload: { entryId: "entry-1" },
      runAt: "2026-05-29T10:00:00.000Z",
    });

    expect(publishScheduledCmsEntryIfDueMock).toHaveBeenCalledWith({ entryId: "entry-1" });
  });

  test("routes credit expiration jobs to the credit processor", async () => {
    await runScheduledJob({
      type: SCHEDULED_JOB_TYPES.CREDIT_EXPIRE_TRANSACTION,
      payload: { transactionId: "transaction-1" },
      runAt: "2026-05-29T10:00:00.000Z",
    });

    expect(processExpiredCreditTransactionIfDueMock).toHaveBeenCalledWith({
      transactionId: "transaction-1",
    });
  });

  test("routes credit refresh jobs to the refresh processor", async () => {
    await runScheduledJob({
      type: SCHEDULED_JOB_TYPES.CREDIT_REFRESH_USER,
      payload: { userId: "user-1" },
      runAt: "2026-05-29T10:00:00.000Z",
    });

    expect(refreshScheduledUserCreditsIfDueMock).toHaveBeenCalledWith({ userId: "user-1" });
  });

  test("renders and sends transactional email jobs", async () => {
    const renderedEmail = {
      to: "user@example.com",
      subject: "Verify",
      html: "<p>Verify</p>",
      text: "Verify",
      type: EMAIL_TEMPLATE_TYPES.EMAIL_VERIFICATION,
    };
    renderTransactionalEmailMock.mockReturnValue(renderedEmail);

    await runScheduledJob({
      type: SCHEDULED_JOB_TYPES.EMAIL_SEND,
      payload: {
        to: "user@example.com",
        template: EMAIL_TEMPLATE_TYPES.EMAIL_VERIFICATION,
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
      data: {
        verificationToken: "token-1",
        username: "Ada",
      },
    });
    expect(sendTransactionalEmailNowMock).toHaveBeenCalledWith(renderedEmail);
  });

  test("rejects invalid payloads before running downstream handlers", async () => {
    await expect(runScheduledJob({
      type: SCHEDULED_JOB_TYPES.CREDIT_REFRESH_USER,
      payload: { userId: "" },
      runAt: "2026-05-29T10:00:00.000Z",
    })).rejects.toThrow();

    expect(refreshScheduledUserCreditsIfDueMock).not.toHaveBeenCalled();
  });
});
