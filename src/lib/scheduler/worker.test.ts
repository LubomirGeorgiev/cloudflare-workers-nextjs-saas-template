import { afterEach, describe, expect, test, vi } from "vitest";

import { SCHEDULED_JOB_TYPES, type ScheduledQueueMessage } from "@/lib/scheduler/jobs";

const {
  dispatchDueCreditExpirationJobsMock,
  dispatchDueCreditRefreshJobsMock,
  dispatchScheduledJobsToQueueMock,
  runScheduledJobMock,
} = vi.hoisted(() => ({
  dispatchDueCreditExpirationJobsMock: vi.fn(),
  dispatchDueCreditRefreshJobsMock: vi.fn(),
  dispatchScheduledJobsToQueueMock: vi.fn(),
  runScheduledJobMock: vi.fn(),
}));

vi.mock("@/lib/scheduler/scheduler", () => ({
  dispatchScheduledJobsToQueue: dispatchScheduledJobsToQueueMock,
  getSchedulerQueueDelayLimitSeconds: () => 60 * 60 * 24,
}));

vi.mock("@/lib/scheduler/job-handlers", () => ({
  runScheduledJob: runScheduledJobMock,
}));

vi.mock("@/utils/credit-scheduler", () => ({
  dispatchDueCreditExpirationJobs: dispatchDueCreditExpirationJobsMock,
  dispatchDueCreditRefreshJobs: dispatchDueCreditRefreshJobsMock,
}));

const { handleSchedulerCron, handleSchedulerQueue } = await import("@/lib/scheduler/worker");

function createMessage({
  attempts = 1,
  runAt,
}: {
  attempts?: number;
  runAt: Date;
}) {
  return {
    id: "message-1",
    attempts,
    body: {
      type: SCHEDULED_JOB_TYPES.CREDIT_REFRESH_USER,
      payload: {
        userId: "user-1",
      },
      runAt: runAt.toISOString(),
    } satisfies ScheduledQueueMessage,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

describe("scheduler worker", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  test("cron dispatches persisted jobs and due credit jobs at the scheduled time", async () => {
    const queue = { send: vi.fn() };
    const now = new Date("2026-05-29T10:00:00.000Z");
    dispatchScheduledJobsToQueueMock.mockResolvedValue(2);
    dispatchDueCreditExpirationJobsMock.mockResolvedValue(3);
    dispatchDueCreditRefreshJobsMock.mockResolvedValue(5);

    await expect(handleSchedulerCron({
      env: {
        SCHEDULER_QUEUE: queue,
      } as unknown as Env,
      now,
    })).resolves.toBe(10);

    expect(dispatchScheduledJobsToQueueMock).toHaveBeenCalledWith({ queue, now });
    expect(dispatchDueCreditExpirationJobsMock).toHaveBeenCalledWith({ queue, now });
    expect(dispatchDueCreditRefreshJobsMock).toHaveBeenCalledWith({ queue, now });
  });

  test("queue retries a message scheduled for the future", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-29T10:00:00.000Z"));
    const message = createMessage({
      runAt: new Date("2026-05-29T10:00:30.000Z"),
    });

    await handleSchedulerQueue({
      messages: [message],
    } as unknown as MessageBatch<ScheduledQueueMessage>);

    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(message.ack).not.toHaveBeenCalled();
    expect(runScheduledJobMock).not.toHaveBeenCalled();
  });

  test("queue runs and acknowledges a due message", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-29T10:00:00.000Z"));
    const message = createMessage({
      runAt: new Date("2026-05-29T10:00:00.000Z"),
    });

    await handleSchedulerQueue({
      messages: [message],
    } as unknown as MessageBatch<ScheduledQueueMessage>);

    expect(runScheduledJobMock).toHaveBeenCalledWith(message.body);
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  test("queue retries a failed due message with a linear backoff", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-29T10:00:00.000Z"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const message = createMessage({
      attempts: 3,
      runAt: new Date("2026-05-29T09:59:59.000Z"),
    });
    runScheduledJobMock.mockRejectedValueOnce(new Error("database unavailable"));

    await handleSchedulerQueue({
      messages: [message],
    } as unknown as MessageBatch<ScheduledQueueMessage>);

    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 90 });
    expect(consoleError).toHaveBeenCalledWith("Scheduled job failed", expect.objectContaining({
      attempts: 3,
      messageId: "message-1",
      type: SCHEDULED_JOB_TYPES.CREDIT_REFRESH_USER,
    }));
    consoleError.mockRestore();
  });
});
