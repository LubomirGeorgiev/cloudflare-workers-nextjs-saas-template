import { afterEach, describe, expect, test, vi } from "vitest";

import { SCHEDULED_JOB_TYPES } from "@/lib/scheduler/jobs";

const { getDBMock } = vi.hoisted(() => ({
  getDBMock: vi.fn(),
}));

vi.mock("@/db", () => ({
  getDB: getDBMock,
}));

const {
  dispatchScheduledJobsToQueue,
  scheduleJob,
} = await import("@/lib/scheduler/scheduler");

function createDeleteChain() {
  return {
    where: vi.fn(async () => undefined),
  };
}

function createInsertChain() {
  return {
    values: vi.fn(() => ({
      onConflictDoUpdate: vi.fn(async () => undefined),
    })),
  };
}

function createQueue() {
  return {
    send: vi.fn(async () => undefined),
  };
}

describe("scheduler persistence", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  test("queues near-term jobs and removes any persisted duplicate", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-29T10:00:00.000Z"));
    const queue = createQueue();
    const deleteChain = createDeleteChain();
    const db = {
      delete: vi.fn(() => deleteChain),
    };
    getDBMock.mockReturnValue(db);
    const runAt = new Date("2026-05-29T10:00:30.000Z");

    await expect(scheduleJob({
      queue: queue as never,
      type: SCHEDULED_JOB_TYPES.CREDIT_REFRESH_USER,
      dedupeKey: "credit-refresh:user-1",
      payload: { userId: "user-1" },
      runAt,
    })).resolves.toBe("queued");

    expect(queue.send).toHaveBeenCalledWith({
      type: SCHEDULED_JOB_TYPES.CREDIT_REFRESH_USER,
      payload: { userId: "user-1" },
      runAt: "2026-05-29T10:00:30.000Z",
    }, {
      delaySeconds: 30,
    });
    expect(db.delete).toHaveBeenCalledOnce();
    expect(deleteChain.where).toHaveBeenCalledOnce();
  });

  test("persists far-future jobs with the dedupe key", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-29T10:00:00.000Z"));
    const queue = createQueue();
    const insertChain = createInsertChain();
    const db = {
      insert: vi.fn(() => insertChain),
    };
    getDBMock.mockReturnValue(db);
    const runAt = new Date("2026-05-31T10:00:01.000Z");

    await expect(scheduleJob({
      queue: queue as never,
      type: SCHEDULED_JOB_TYPES.CREDIT_REFRESH_USER,
      dedupeKey: "credit-refresh:user-1",
      payload: { userId: "user-1" },
      runAt,
    })).resolves.toBe("persisted");

    expect(queue.send).not.toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalledOnce();
    expect(insertChain.values).toHaveBeenCalledWith({
      type: SCHEDULED_JOB_TYPES.CREDIT_REFRESH_USER,
      dedupeKey: "credit-refresh:user-1",
      payload: { userId: "user-1" },
      runAt,
    });
  });

  test("dispatches persisted jobs in run order and deletes them after enqueueing", async () => {
    const queue = createQueue();
    const now = new Date("2026-05-29T10:00:00.000Z");
    const firstRunAt = new Date("2026-05-29T09:59:00.000Z");
    const secondRunAt = new Date("2026-05-29T10:00:45.000Z");
    const deleteChain = createDeleteChain();
    const db = {
      query: {
        scheduledJobTable: {
          findMany: vi.fn(async () => [
            {
              id: "job-1",
              type: SCHEDULED_JOB_TYPES.CREDIT_REFRESH_USER,
              payload: { userId: "user-1" },
              runAt: firstRunAt,
            },
            {
              id: "job-2",
              type: SCHEDULED_JOB_TYPES.CREDIT_EXPIRE_TRANSACTION,
              payload: { transactionId: "transaction-1" },
              runAt: secondRunAt,
            },
          ]),
        },
      },
      delete: vi.fn(() => deleteChain),
    };
    getDBMock.mockReturnValue(db);

    await expect(dispatchScheduledJobsToQueue({
      queue: queue as never,
      now,
      limit: 2,
    })).resolves.toBe(2);

    expect(db.query.scheduledJobTable.findMany).toHaveBeenCalledWith(expect.objectContaining({
      limit: 2,
    }));
    expect(queue.send).toHaveBeenNthCalledWith(1, {
      type: SCHEDULED_JOB_TYPES.CREDIT_REFRESH_USER,
      payload: { userId: "user-1" },
      runAt: "2026-05-29T09:59:00.000Z",
    }, {
      delaySeconds: 0,
    });
    expect(queue.send).toHaveBeenNthCalledWith(2, {
      type: SCHEDULED_JOB_TYPES.CREDIT_EXPIRE_TRANSACTION,
      payload: { transactionId: "transaction-1" },
      runAt: "2026-05-29T10:00:45.000Z",
    }, {
      delaySeconds: 45,
    });
    expect(db.delete).toHaveBeenCalledTimes(2);
    expect(deleteChain.where).toHaveBeenCalledTimes(2);
  });
});
