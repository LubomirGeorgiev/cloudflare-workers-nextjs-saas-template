import { afterEach, describe, expect, test, vi } from "vitest";

import { DISABLE_CREDIT_BILLING_SYSTEM } from "@/constants";
import { SCHEDULED_JOB_TYPES } from "@/lib/scheduler/jobs";

const describeCreditBilling = DISABLE_CREDIT_BILLING_SYSTEM
  ? describe.skip
  : describe;

const describeDisabledCreditBilling = DISABLE_CREDIT_BILLING_SYSTEM
  ? describe
  : describe.skip;

const {
  getCloudflareContextMock,
  getDBMock,
  scheduleJobMock,
  updateAllSessionsOfUserMock,
} = vi.hoisted(() => ({
  getCloudflareContextMock: vi.fn(),
  getDBMock: vi.fn(),
  scheduleJobMock: vi.fn(),
  updateAllSessionsOfUserMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/db", () => ({
  getDB: getDBMock,
}));

vi.mock("@/utils/cloudflare-context", () => ({
  getCloudflareContext: getCloudflareContextMock,
}));

vi.mock("@/lib/scheduler/scheduler", () => ({
  scheduleJob: scheduleJobMock,
}));

vi.mock("@/utils/kv-session", () => ({
  updateAllSessionsOfUser: updateAllSessionsOfUserMock,
}));

const {
  dispatchDueCreditExpirationJobs,
  dispatchDueCreditRefreshJobs,
  processExpiredCreditTransactionIfDue,
  scheduleCreditExpiration,
  scheduleUserCreditRefresh,
} = await import("@/utils/credit-scheduler");

function createQueue() {
  return {
    send: vi.fn(),
  };
}

function createCreditTransactionUpdateChain(returnedRows: unknown[]) {
  return {
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => returnedRows),
      })),
    })),
  };
}

function createUserUpdateChain() {
  return {
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => [{ currentCredits: 0 }]),
      })),
    })),
  };
}

function getSqlText(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const queryChunks = "queryChunks" in value
    ? (value as { queryChunks?: unknown[] }).queryChunks
    : undefined;

  if (!queryChunks) {
    return "";
  }

  return queryChunks
    .map((chunk) => {
      if (chunk && typeof chunk === "object" && "value" in chunk) {
        const rawValue = (chunk as { value?: unknown }).value;
        return Array.isArray(rawValue) ? rawValue.join("") : String(rawValue ?? "");
      }

      return getSqlText(chunk);
    })
    .join("");
}

function createStatefulExpirationDb({
  transaction,
  user,
}: {
  transaction: {
    id: string;
    userId: string;
    remainingAmount: number;
    expirationDate: Date;
    expirationDateProcessedAt: Date | null;
  };
  user: {
    id: string;
    currentCredits: number;
  };
}) {
  let updateCount = 0;

  return {
    query: {
      creditTransactionTable: {
        findFirst: vi.fn(async () => ({ ...transaction })),
      },
    },
    update: vi.fn(() => {
      updateCount += 1;

      if (updateCount % 2 === 1) {
        return {
          set: vi.fn((values: { remainingAmount: number; expirationDateProcessedAt: Date }) => ({
            where: vi.fn(() => ({
              returning: vi.fn(async () => {
                if (
                  transaction.expirationDate > values.expirationDateProcessedAt
                  || transaction.expirationDateProcessedAt
                  || transaction.remainingAmount <= 0
                ) {
                  return [];
                }

                transaction.expirationDateProcessedAt = values.expirationDateProcessedAt;
                transaction.remainingAmount = values.remainingAmount;

                return [{
                  userId: transaction.userId,
                  remainingAmount: transaction.remainingAmount,
                }];
              }),
            })),
          })),
        };
      }

      return {
        set: vi.fn(() => ({
          where: vi.fn((condition: unknown) => {
            if (!getSqlText(condition).includes(">=")) {
              user.currentCredits -= 10;

              return Promise.resolve(undefined);
            }

            return {
              returning: vi.fn(async () => {
                if (user.currentCredits < 10) {
                  return [];
                }

                user.currentCredits -= 10;

                return [{ currentCredits: user.currentCredits }];
              }),
            };
          }),
        })),
      };
    }),
  };
}

describeCreditBilling("credit scheduler", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("schedules an immediate user credit refresh when no prior refresh exists", async () => {
    const queue = createQueue();
    const now = new Date(2026, 4, 29, 10, 0, 0, 0);
    getCloudflareContextMock.mockResolvedValue({
      env: {
        SCHEDULER_QUEUE: queue,
      },
    });

    await scheduleUserCreditRefresh({
      userId: "user-1",
      now,
    });

    expect(scheduleJobMock).toHaveBeenCalledWith({
      queue,
      type: SCHEDULED_JOB_TYPES.CREDIT_REFRESH_USER,
      dedupeKey: "credit-refresh:user-1",
      payload: {
        userId: "user-1",
      },
      runAt: now,
    });
  });

  test("schedules a future user credit refresh at the next calendar-month boundary", async () => {
    const queue = createQueue();
    const now = new Date(2026, 4, 1, 10, 0, 0, 0);
    getCloudflareContextMock.mockResolvedValue({
      env: {
        SCHEDULER_QUEUE: queue,
      },
    });

    await scheduleUserCreditRefresh({
      userId: "user-1",
      lastCreditRefreshAt: new Date(2026, 3, 29, 10, 0, 0, 0),
      now,
    });

    expect(scheduleJobMock).toHaveBeenCalledWith({
      queue,
      type: SCHEDULED_JOB_TYPES.CREDIT_REFRESH_USER,
      dedupeKey: "credit-refresh:user-1",
      payload: {
        userId: "user-1",
      },
      runAt: new Date(2026, 4, 29, 10, 0, 0, 0),
    });
  });

  test("schedules credit expiration at the transaction expiration date", async () => {
    const queue = createQueue();
    const expirationDate = new Date(2027, 4, 29, 10, 0, 0, 0);
    getCloudflareContextMock.mockResolvedValue({
      env: {
        SCHEDULER_QUEUE: queue,
      },
    });

    await scheduleCreditExpiration({
      transactionId: "transaction-1",
      expirationDate,
    });

    expect(scheduleJobMock).toHaveBeenCalledWith({
      queue,
      type: SCHEDULED_JOB_TYPES.CREDIT_EXPIRE_TRANSACTION,
      dedupeKey: "credit-expiration:transaction-1",
      payload: {
        transactionId: "transaction-1",
      },
      runAt: expirationDate,
    });
  });

  test("dispatches due credit refresh jobs to the queue", async () => {
    const queue = createQueue();
    const now = new Date(2026, 4, 29, 10, 0, 0, 0);
    getDBMock.mockReturnValue({
      query: {
        userTable: {
          findMany: vi.fn(async () => [
            { id: "user-1" },
            { id: "user-2" },
          ]),
        },
      },
    });

    await expect(dispatchDueCreditRefreshJobs({
      queue: queue as unknown as Cloudflare.Env["SCHEDULER_QUEUE"],
      now,
    })).resolves.toBe(2);

    expect(queue.send).toHaveBeenCalledTimes(2);
    expect(queue.send).toHaveBeenNthCalledWith(1, {
      type: SCHEDULED_JOB_TYPES.CREDIT_REFRESH_USER,
      payload: {
        userId: "user-1",
      },
      runAt: now.toISOString(),
    });
    expect(queue.send).toHaveBeenNthCalledWith(2, {
      type: SCHEDULED_JOB_TYPES.CREDIT_REFRESH_USER,
      payload: {
        userId: "user-2",
      },
      runAt: now.toISOString(),
    });
  });

  test("dispatches due credit expiration jobs to the queue", async () => {
    const queue = createQueue();
    const now = new Date(2026, 4, 29, 10, 0, 0, 0);
    getDBMock.mockReturnValue({
      query: {
        creditTransactionTable: {
          findMany: vi.fn(async () => [
            { id: "transaction-1" },
            { id: "transaction-2" },
          ]),
        },
      },
    });

    await expect(dispatchDueCreditExpirationJobs({
      queue: queue as unknown as Cloudflare.Env["SCHEDULER_QUEUE"],
      now,
    })).resolves.toBe(2);

    expect(queue.send).toHaveBeenCalledTimes(2);
    expect(queue.send).toHaveBeenNthCalledWith(1, {
      type: SCHEDULED_JOB_TYPES.CREDIT_EXPIRE_TRANSACTION,
      payload: {
        transactionId: "transaction-1",
      },
      runAt: now.toISOString(),
    });
    expect(queue.send).toHaveBeenNthCalledWith(2, {
      type: SCHEDULED_JOB_TYPES.CREDIT_EXPIRE_TRANSACTION,
      payload: {
        transactionId: "transaction-2",
      },
      runAt: now.toISOString(),
    });
  });

  test("ignores missing credit transactions during expiration processing", async () => {
    const db = {
      query: {
        creditTransactionTable: {
          findFirst: vi.fn(async () => null),
        },
      },
      update: vi.fn(),
    };
    getDBMock.mockReturnValue(db);

    await processExpiredCreditTransactionIfDue({
      transactionId: "transaction-1",
      now: new Date(2026, 4, 29, 10, 0, 0, 0),
    });

    expect(db.update).not.toHaveBeenCalled();
    expect(updateAllSessionsOfUserMock).not.toHaveBeenCalled();
  });

  test("does not update user credits when expiration processing does not claim the transaction", async () => {
    const transactionUpdate = createCreditTransactionUpdateChain([]);
    const db = {
      query: {
        creditTransactionTable: {
          findFirst: vi.fn(async () => ({
            id: "transaction-1",
            userId: "user-1",
            remainingAmount: 10,
          })),
        },
      },
      update: vi.fn(() => transactionUpdate),
    };
    getDBMock.mockReturnValue(db);

    await processExpiredCreditTransactionIfDue({
      transactionId: "transaction-1",
      now: new Date(2026, 4, 29, 10, 0, 0, 0),
    });

    expect(db.update).toHaveBeenCalledTimes(1);
    expect(updateAllSessionsOfUserMock).not.toHaveBeenCalled();
  });

  test("decrements user credits and updates sessions after claiming an expired transaction", async () => {
    const transactionUpdate = createCreditTransactionUpdateChain([{
      userId: "user-1",
      remainingAmount: 10,
    }]);
    const userUpdate = createUserUpdateChain();
    const db = {
      query: {
        creditTransactionTable: {
          findFirst: vi.fn(async () => ({
            id: "transaction-1",
            userId: "user-1",
            remainingAmount: 10,
          })),
        },
      },
      update: vi.fn()
        .mockReturnValueOnce(transactionUpdate)
        .mockReturnValueOnce(userUpdate),
    };
    getDBMock.mockReturnValue(db);

    await processExpiredCreditTransactionIfDue({
      transactionId: "transaction-1",
      now: new Date(2026, 4, 29, 10, 0, 0, 0),
    });

    expect(db.update).toHaveBeenCalledTimes(2);
    expect(userUpdate.set).toHaveBeenCalledOnce();
    expect(updateAllSessionsOfUserMock).toHaveBeenCalledWith("user-1");
  });

  test("does not expire credits before the expiration date", async () => {
    const now = new Date(2026, 4, 29, 10, 0, 0, 0);
    const transaction = {
      id: "transaction-1",
      userId: "user-1",
      remainingAmount: 10,
      expirationDate: new Date(2026, 4, 29, 10, 0, 0, 1),
      expirationDateProcessedAt: null,
    };
    const user = {
      id: "user-1",
      currentCredits: 20,
    };
    const db = createStatefulExpirationDb({ transaction, user });
    getDBMock.mockReturnValue(db);

    await processExpiredCreditTransactionIfDue({
      transactionId: transaction.id,
      now,
    });

    expect(transaction.remainingAmount).toBe(10);
    expect(transaction.expirationDateProcessedAt).toBeNull();
    expect(user.currentCredits).toBe(20);
    expect(updateAllSessionsOfUserMock).not.toHaveBeenCalled();
  });

  test("expires credits exactly at the expiration date", async () => {
    const now = new Date(2026, 4, 29, 10, 0, 0, 0);
    const transaction = {
      id: "transaction-1",
      userId: "user-1",
      remainingAmount: 10,
      expirationDate: now,
      expirationDateProcessedAt: null,
    };
    const user = {
      id: "user-1",
      currentCredits: 20,
    };
    const db = createStatefulExpirationDb({ transaction, user });
    getDBMock.mockReturnValue(db);

    await processExpiredCreditTransactionIfDue({
      transactionId: transaction.id,
      now,
    });

    expect(transaction.remainingAmount).toBe(0);
    expect(transaction.expirationDateProcessedAt).toBe(now);
    expect(user.currentCredits).toBe(10);
    expect(updateAllSessionsOfUserMock).toHaveBeenCalledWith("user-1");
  });

  test("expires a transaction only once when processing runs repeatedly", async () => {
    const now = new Date(2026, 4, 29, 10, 0, 0, 0);
    const transaction = {
      id: "transaction-1",
      userId: "user-1",
      remainingAmount: 10,
      expirationDate: now,
      expirationDateProcessedAt: null,
    };
    const user = {
      id: "user-1",
      currentCredits: 20,
    };
    const db = createStatefulExpirationDb({ transaction, user });
    getDBMock.mockReturnValue(db);

    await processExpiredCreditTransactionIfDue({
      transactionId: transaction.id,
      now,
    });
    await processExpiredCreditTransactionIfDue({
      transactionId: transaction.id,
      now: new Date(2026, 4, 29, 10, 0, 1, 0),
    });

    expect(transaction.remainingAmount).toBe(0);
    expect(user.currentCredits).toBe(10);
    expect(updateAllSessionsOfUserMock).toHaveBeenCalledOnce();
  });

  test("does not let expiration make current credits negative", async () => {
    const now = new Date(2026, 4, 29, 10, 0, 0, 0);
    const transaction = {
      id: "transaction-1",
      userId: "user-1",
      remainingAmount: 10,
      expirationDate: now,
      expirationDateProcessedAt: null,
    };
    const user = {
      id: "user-1",
      currentCredits: 5,
    };
    const db = createStatefulExpirationDb({ transaction, user });
    getDBMock.mockReturnValue(db);

    await processExpiredCreditTransactionIfDue({
      transactionId: transaction.id,
      now,
    });

    expect(user.currentCredits).toBe(5);
    expect(updateAllSessionsOfUserMock).not.toHaveBeenCalled();
  });
});

describeDisabledCreditBilling("disabled credit scheduler", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("scheduler operations are no-ops", async () => {
    await expect(scheduleUserCreditRefresh({
      userId: "user-1",
    })).resolves.toBeUndefined();

    await expect(scheduleCreditExpiration({
      transactionId: "transaction-1",
      expirationDate: new Date(2027, 4, 29, 10, 0, 0, 0),
    })).resolves.toBeUndefined();

    await expect(processExpiredCreditTransactionIfDue({
      transactionId: "transaction-1",
    })).resolves.toBeUndefined();

    await expect(dispatchDueCreditRefreshJobs({
      queue: createQueue() as unknown as Cloudflare.Env["SCHEDULER_QUEUE"],
    })).resolves.toBe(0);

    await expect(dispatchDueCreditExpirationJobs({
      queue: createQueue() as unknown as Cloudflare.Env["SCHEDULER_QUEUE"],
    })).resolves.toBe(0);

    expect(getCloudflareContextMock).not.toHaveBeenCalled();
    expect(getDBMock).not.toHaveBeenCalled();
    expect(scheduleJobMock).not.toHaveBeenCalled();
    expect(updateAllSessionsOfUserMock).not.toHaveBeenCalled();
  });
});
