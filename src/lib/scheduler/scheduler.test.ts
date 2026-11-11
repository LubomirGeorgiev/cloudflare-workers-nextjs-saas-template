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
      type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
      dedupeKey: "cms-publish:entry-1",
      payload: { entryId: "entry-1" },
      runAt,
    })).resolves.toBe("queued");

    expect(queue.send).toHaveBeenCalledWith({
      type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
      payload: { entryId: "entry-1" },
      runAt: "2026-05-29T10:00:30.000Z",
    }, {
      delaySeconds: 30,
    });
    expect(db.delete).toHaveBeenCalledOnce();
    expect(deleteChain.where).toHaveBeenCalledOnce();
  });

  test("persists a durable job before the send and clears it after", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-29T10:00:00.000Z"));
    const queue = createQueue();
    const insertChain = createInsertChain();
    const deleteChain = createDeleteChain();
    const db = {
      insert: vi.fn(() => insertChain),
      delete: vi.fn(() => deleteChain),
    };
    getDBMock.mockReturnValue(db);
    const runAt = new Date("2026-05-29T10:00:00.000Z");

    await expect(scheduleJob({
      queue: queue as never,
      type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
      dedupeKey: "cms-publish:entry-1",
      payload: { entryId: "entry-1" },
      runAt,
      durable: true,
    })).resolves.toBe("queued");

    expect(insertChain.values).toHaveBeenCalledWith({
      type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
      dedupeKey: "cms-publish:entry-1",
      payload: { entryId: "entry-1" },
      runAt,
    });
    // The order is the whole point: the row has to exist before the send can lose the message.
    expect(db.insert.mock.invocationCallOrder[0])
      .toBeLessThan(queue.send.mock.invocationCallOrder[0]);
    expect(queue.send.mock.invocationCallOrder[0])
      .toBeLessThan(db.delete.mock.invocationCallOrder[0]);
  });

  test("resolves persisted and keeps the row when a durable send fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const queue = createQueue();
    queue.send.mockRejectedValue(new Error("queue unavailable"));
    const insertChain = createInsertChain();
    const deleteChain = createDeleteChain();
    const db = {
      insert: vi.fn(() => insertChain),
      delete: vi.fn(() => deleteChain),
    };
    getDBMock.mockReturnValue(db);

    await expect(scheduleJob({
      queue: queue as never,
      type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
      dedupeKey: "cms-publish:entry-1",
      payload: { entryId: "entry-1" },
      runAt: new Date(),
      durable: true,
    })).resolves.toBe("persisted");

    expect(db.insert).toHaveBeenCalledOnce();
    // Deleting here would drop the only record of the job the cron has left to re-dispatch.
    expect(db.delete).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledOnce();
    const line = String(consoleError.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({ operation: "send", jobType: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY });
    expect(line).not.toContain("entry-1");
    consoleError.mockRestore();
  });

  test("resolves persisted when the delete fails after a good durable send", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const queue = createQueue();
    const insertChain = createInsertChain();
    const db = {
      insert: vi.fn(() => insertChain),
      delete: vi.fn(() => ({ where: vi.fn(async () => { throw new Error("d1 unavailable"); }) })),
    };
    getDBMock.mockReturnValue(db);

    await expect(scheduleJob({
      queue: queue as never,
      type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
      dedupeKey: "cms-publish:entry-1",
      payload: { entryId: "entry-1" },
      runAt: new Date(),
      durable: true,
    })).resolves.toBe("persisted");

    expect(queue.send).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledOnce();
    expect(JSON.parse(String(consoleError.mock.calls[0]?.[0]))).toMatchObject({ operation: "delete" });
    consoleError.mockRestore();
  });

  test("rejects and sends nothing when the durable insert fails", async () => {
    const queue = createQueue();
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          onConflictDoUpdate: vi.fn(async () => { throw new Error("insert failed"); }),
        })),
      })),
      delete: vi.fn(() => createDeleteChain()),
    };
    getDBMock.mockReturnValue(db);

    await expect(scheduleJob({
      queue: queue as never,
      type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
      dedupeKey: "cms-publish:entry-1",
      payload: { entryId: "entry-1" },
      runAt: new Date(),
      durable: true,
    })).rejects.toThrow("insert failed");

    expect(queue.send).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });

  test("still rejects when a non-durable send fails", async () => {
    const queue = createQueue();
    queue.send.mockRejectedValue(new Error("queue unavailable"));
    const db = { delete: vi.fn(() => createDeleteChain()) };
    getDBMock.mockReturnValue(db);

    await expect(scheduleJob({
      queue: queue as never,
      type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
      dedupeKey: "cms-publish:entry-1",
      payload: { entryId: "entry-1" },
      runAt: new Date(),
    })).rejects.toThrow("queue unavailable");

    expect(db.delete).not.toHaveBeenCalled();
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
      type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
      dedupeKey: "cms-publish:entry-1",
      payload: { entryId: "entry-1" },
      runAt,
    })).resolves.toBe("persisted");

    expect(queue.send).not.toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalledOnce();
    expect(insertChain.values).toHaveBeenCalledWith({
      type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
      dedupeKey: "cms-publish:entry-1",
      payload: { entryId: "entry-1" },
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
              type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
              payload: { entryId: "entry-1" },
              runAt: firstRunAt,
            },
            {
              id: "job-2",
              type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
              payload: { entryId: "entry-2" },
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
      type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
      payload: { entryId: "entry-1" },
      runAt: "2026-05-29T09:59:00.000Z",
    }, {
      delaySeconds: 0,
    });
    expect(queue.send).toHaveBeenNthCalledWith(2, {
      type: SCHEDULED_JOB_TYPES.CMS_PUBLISH_ENTRY,
      payload: { entryId: "entry-2" },
      runAt: "2026-05-29T10:00:45.000Z",
    }, {
      delaySeconds: 45,
    });
    expect(db.delete).toHaveBeenCalledTimes(2);
    expect(deleteChain.where).toHaveBeenCalledTimes(2);
  });
});
