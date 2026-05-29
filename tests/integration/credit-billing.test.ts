/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
} from "cloudflare:test";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { getDB } from "@/db";
import {
  CREDIT_TRANSACTION_TYPE,
  creditTransactionTable,
  scheduledJobTable,
  userTable,
} from "@/db/schema";
import {
  createScheduledQueueMessage,
  SCHEDULED_JOB_TYPES,
  type ScheduledQueueMessage,
} from "@/lib/scheduler/jobs";
import {
  handleSchedulerCron,
  handleSchedulerQueue,
} from "@/lib/scheduler/worker";
import {
  processExpiredCreditTransactionIfDue,
  scheduleUserCreditRefresh,
} from "@/utils/credit-scheduler";
import { getOneCalendarMonthAfter } from "@/utils/credit-periods";
import {
  CURRENT_SESSION_VERSION,
  type KVSession,
} from "@/utils/kv-session";
import {
  consumeCredits,
  refreshUserMonthlyCreditsIfDue,
} from "@/utils/credits";

const db = getDB();
const dayInMs = 24 * 60 * 60 * 1000;

function secondsDate(time: number): Date {
  return new Date(Math.floor(time / 1000) * 1000);
}

function futureDate(daysFromNow: number): Date {
  return secondsDate(Date.now() + daysFromNow * dayInMs);
}

async function clearCreditBillingRows(): Promise<void> {
  await env.NEXT_TAG_CACHE_D1.batch([
    env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM scheduled_job"),
    env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM credit_transaction"),
    env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM team_membership"),
    env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM user"),
  ]);
}

async function clearKV(): Promise<void> {
  const keys = await env.NEXT_INC_CACHE_KV.list();
  await Promise.all(keys.keys.map((key) => env.NEXT_INC_CACHE_KV.delete(key.name)));
}

async function createUser({
  currentCredits = 0,
  id,
  lastCreditRefreshAt = null,
}: {
  currentCredits?: number;
  id: string;
  lastCreditRefreshAt?: Date | null;
}): Promise<void> {
  await db.insert(userTable).values({
    id,
    currentCredits,
    email: `${id}@example.com`,
    lastCreditRefreshAt,
  });
}

async function seedSession({
  sessionId = "session-1",
  userId,
}: {
  sessionId?: string;
  userId: string;
}): Promise<string> {
  const user = await db.query.userTable.findFirst({
    where: (table, { eq }) => eq(table.id, userId),
  });

  if (!user) {
    throw new Error(`User not found: ${userId}`);
  }

  const expiresAt = new Date(Date.now() + 30 * dayInMs);
  const session: KVSession = {
    id: sessionId,
    userId,
    expiresAt: expiresAt.getTime(),
    createdAt: Date.now(),
    user,
    teams: [],
    version: CURRENT_SESSION_VERSION,
  };
  const key = `session:${userId}:${sessionId}`;

  await env.NEXT_INC_CACHE_KV.put(key, JSON.stringify(session), {
    expirationTtl: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
  });

  return key;
}

async function readSingleColumn<T>({
  column,
  sql,
}: {
  column: string;
  sql: string;
}): Promise<T> {
  const result = await env.NEXT_TAG_CACHE_D1.prepare(sql).first<T>(column);

  if (result === null) {
    throw new Error(`Expected query to return a row: ${sql}`);
  }

  return result;
}

describe("credit billing integration", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await clearKV();
    await clearCreditBillingRows();
  });

  test("monthly refresh writes credits, transaction, expiration job, and next refresh job in D1", async () => {
    const now = futureDate(35);
    const userId = "credit-refresh-user";
    await createUser({ id: userId, lastCreditRefreshAt: null });

    await refreshUserMonthlyCreditsIfDue({ userId, now });

    const user = await db.query.userTable.findFirst({
      where: (table, { eq }) => eq(table.id, userId),
    });
    const transactions = await db.query.creditTransactionTable.findMany({
      where: (table, { eq }) => eq(table.userId, userId),
    });
    const scheduledJobs = await db.query.scheduledJobTable.findMany({
      orderBy: (table, { asc }) => [asc(table.type)],
    });
    const expectedNextMonthlyDate = getOneCalendarMonthAfter(now);

    expect(user?.currentCredits).toBe(50);
    expect(user?.lastCreditRefreshAt).toEqual(now);
    expect(transactions).toEqual([
      expect.objectContaining({
        amount: 50,
        description: "Free monthly credits",
        expirationDate: expectedNextMonthlyDate,
        remainingAmount: 50,
        type: CREDIT_TRANSACTION_TYPE.MONTHLY_REFRESH,
        userId,
      }),
    ]);
    expect(scheduledJobs).toEqual([
      expect.objectContaining({
        dedupeKey: `credit-expiration:${transactions[0]?.id}`,
        payload: {
          transactionId: transactions[0]?.id,
        },
        runAt: expectedNextMonthlyDate,
        type: SCHEDULED_JOB_TYPES.CREDIT_EXPIRE_TRANSACTION,
      }),
      expect.objectContaining({
        dedupeKey: `credit-refresh:${userId}`,
        payload: {
          userId,
        },
        runAt: expectedNextMonthlyDate,
        type: SCHEDULED_JOB_TYPES.CREDIT_REFRESH_USER,
      }),
    ]);
  });

  test("monthly refresh does not double-add credits when called repeatedly", async () => {
    const now = futureDate(35);
    const userId = "credit-refresh-idempotent-user";
    await createUser({ id: userId, lastCreditRefreshAt: null });

    await refreshUserMonthlyCreditsIfDue({ userId, now });
    await refreshUserMonthlyCreditsIfDue({ userId, now });

    const user = await db.query.userTable.findFirst({
      where: (table, { eq }) => eq(table.id, userId),
    });
    const transactions = await db.query.creditTransactionTable.findMany({
      where: (table, { eq }) => eq(table.userId, userId),
    });
    const scheduledJobs = await db.query.scheduledJobTable.findMany({
      where: (table, { eq }) => eq(table.dedupeKey, `credit-refresh:${userId}`),
    });

    expect(user?.currentCredits).toBe(50);
    expect(transactions).toHaveLength(1);
    expect(scheduledJobs).toHaveLength(1);
  });

  test("fresh monthly refresh only schedules the next refresh", async () => {
    const lastCreditRefreshAt = futureDate(30);
    const now = new Date(lastCreditRefreshAt.getTime() + dayInMs);
    const userId = "credit-refresh-fresh-user";
    await createUser({
      currentCredits: 15,
      id: userId,
      lastCreditRefreshAt,
    });

    await refreshUserMonthlyCreditsIfDue({ userId, now });

    const user = await db.query.userTable.findFirst({
      where: (table, { eq }) => eq(table.id, userId),
    });
    const transactions = await db.query.creditTransactionTable.findMany({
      where: (table, { eq }) => eq(table.userId, userId),
    });
    const scheduledJobs = await db.query.scheduledJobTable.findMany({
      where: (table, { eq }) => eq(table.dedupeKey, `credit-refresh:${userId}`),
    });

    expect(user?.currentCredits).toBe(15);
    expect(user?.lastCreditRefreshAt).toEqual(lastCreditRefreshAt);
    expect(transactions).toHaveLength(0);
    expect(scheduledJobs).toEqual([
      expect.objectContaining({
        payload: { userId },
        runAt: getOneCalendarMonthAfter(lastCreditRefreshAt),
        type: SCHEDULED_JOB_TYPES.CREDIT_REFRESH_USER,
      }),
    ]);
  });

  test("immediate refresh scheduling uses the queue instead of persisting a D1 job", async () => {
    const now = secondsDate(Date.now());
    const userId = "credit-refresh-immediate-user";

    await scheduleUserCreditRefresh({ userId, now });

    const scheduledJobs = await db.query.scheduledJobTable.findMany({
      where: (table, { eq }) => eq(table.dedupeKey, `credit-refresh:${userId}`),
    });

    expect(scheduledJobs).toHaveLength(0);
  });

  test("expiration is exactly due and idempotent against real D1 rows", async () => {
    const now = futureDate(35);
    const userId = "credit-expiration-user";
    await createUser({ currentCredits: 10, id: userId });
    const [transaction] = await db.insert(creditTransactionTable).values({
      userId,
      amount: 10,
      remainingAmount: 10,
      type: CREDIT_TRANSACTION_TYPE.MONTHLY_REFRESH,
      description: "Free monthly credits",
      expirationDate: now,
    }).returning();

    await processExpiredCreditTransactionIfDue({
      transactionId: transaction.id,
      now: new Date(now.getTime() - 1_000),
    });

    await expect(readSingleColumn<number>({
      column: "currentCredits",
      sql: `SELECT currentCredits FROM user WHERE id = '${userId}'`,
    })).resolves.toBe(10);

    await processExpiredCreditTransactionIfDue({
      transactionId: transaction.id,
      now,
    });
    await processExpiredCreditTransactionIfDue({
      transactionId: transaction.id,
      now: new Date(now.getTime() + 1),
    });

    const expiredTransaction = await db.query.creditTransactionTable.findFirst({
      where: (table, { eq }) => eq(table.id, transaction.id),
    });
    const currentCredits = await readSingleColumn<number>({
      column: "currentCredits",
      sql: `SELECT currentCredits FROM user WHERE id = '${userId}'`,
    });

    expect(currentCredits).toBe(0);
    expect(expiredTransaction?.remainingAmount).toBe(0);
    expect(expiredTransaction?.expirationDateProcessedAt).toEqual(now);
  });

  test("expiration does not make current credits negative against real D1 rows", async () => {
    const now = futureDate(35);
    const userId = "credit-expiration-negative-user";
    await createUser({ currentCredits: 5, id: userId });
    const [transaction] = await db.insert(creditTransactionTable).values({
      userId,
      amount: 10,
      remainingAmount: 10,
      type: CREDIT_TRANSACTION_TYPE.MONTHLY_REFRESH,
      description: "Free monthly credits",
      expirationDate: now,
    }).returning();

    await processExpiredCreditTransactionIfDue({
      transactionId: transaction.id,
      now,
    });

    const currentCredits = await readSingleColumn<number>({
      column: "currentCredits",
      sql: `SELECT currentCredits FROM user WHERE id = '${userId}'`,
    });

    expect(currentCredits).toBe(5);
  });

  test("queue batch processing runs a due credit expiration job and acknowledges it", async () => {
    const now = secondsDate(Date.now() - 1_000);
    const userId = "credit-queue-expiration-user";
    await createUser({ currentCredits: 10, id: userId });
    const [transaction] = await db.insert(creditTransactionTable).values({
      userId,
      amount: 10,
      remainingAmount: 10,
      type: CREDIT_TRANSACTION_TYPE.MONTHLY_REFRESH,
      description: "Free monthly credits",
      expirationDate: now,
    }).returning();
    const batch = createMessageBatch<ScheduledQueueMessage>(
      "credit-billing-integration-scheduler",
      [{
        id: "credit-expiration-message",
        timestamp: now,
        attempts: 1,
        body: createScheduledQueueMessage({
          type: SCHEDULED_JOB_TYPES.CREDIT_EXPIRE_TRANSACTION,
          payload: { transactionId: transaction.id },
          runAt: now,
        }),
      } as never],
    );
    const ctx = createExecutionContext();

    await handleSchedulerQueue(batch);
    const queueResult = await getQueueResult(batch, ctx);

    const expiredTransaction = await db.query.creditTransactionTable.findFirst({
      where: (table, { eq }) => eq(table.id, transaction.id),
    });
    const currentCredits = await readSingleColumn<number>({
      column: "currentCredits",
      sql: `SELECT currentCredits FROM user WHERE id = '${userId}'`,
    });

    expect(queueResult).toEqual(expect.objectContaining({
      outcome: "ok",
    }));
    expect(currentCredits).toBe(0);
    expect(expiredTransaction?.remainingAmount).toBe(0);
  });

  test("queue batch processing runs a due credit refresh job and acknowledges it", async () => {
    const now = secondsDate(Date.now() - 1_000);
    const userId = "credit-queue-refresh-user";
    await createUser({ id: userId, lastCreditRefreshAt: null });
    const batch = createMessageBatch<ScheduledQueueMessage>(
      "credit-billing-integration-scheduler",
      [{
        id: "credit-refresh-message",
        timestamp: now,
        attempts: 1,
        body: createScheduledQueueMessage({
          type: SCHEDULED_JOB_TYPES.CREDIT_REFRESH_USER,
          payload: { userId },
          runAt: now,
        }),
      } as never],
    );
    const ctx = createExecutionContext();

    await handleSchedulerQueue(batch);
    const queueResult = await getQueueResult(batch, ctx);

    const user = await db.query.userTable.findFirst({
      where: (table, { eq }) => eq(table.id, userId),
    });
    const transactions = await db.query.creditTransactionTable.findMany({
      where: (table, { eq }) => eq(table.userId, userId),
    });

    expect(queueResult).toEqual(expect.objectContaining({
      explicitAcks: ["credit-refresh-message"],
      retryMessages: [],
    }));
    expect(user?.currentCredits).toBe(50);
    expect(transactions).toEqual([
      expect.objectContaining({
        amount: 50,
        remainingAmount: 50,
        type: CREDIT_TRANSACTION_TYPE.MONTHLY_REFRESH,
      }),
    ]);
  });

  test("queue batch processing retries failed credit jobs", async () => {
    const now = secondsDate(Date.now() - 1_000);
    const consoleErrorMock = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const batch = createMessageBatch<ScheduledQueueMessage>(
      "credit-billing-integration-scheduler",
      [{
        id: "credit-expiration-invalid-message",
        timestamp: now,
        attempts: 2,
        body: {
          type: SCHEDULED_JOB_TYPES.CREDIT_EXPIRE_TRANSACTION,
          payload: {},
          runAt: now.toISOString(),
        },
      } as never],
    );
    const ctx = createExecutionContext();

    await handleSchedulerQueue(batch);
    const queueResult = await getQueueResult(batch, ctx);

    expect(queueResult).toEqual(expect.objectContaining({
      explicitAcks: [],
      retryMessages: [{ msgId: "credit-expiration-invalid-message" }],
    }));
    expect(consoleErrorMock).toHaveBeenCalledWith(
      "Scheduled job failed",
      expect.objectContaining({
        messageId: "credit-expiration-invalid-message",
        type: SCHEDULED_JOB_TYPES.CREDIT_EXPIRE_TRANSACTION,
      }),
    );
  });

  test("cron dispatches persisted scheduled jobs and due credit jobs from real D1 state", async () => {
    const now = futureDate(35);
    const refreshUserId = "credit-cron-refresh-user";
    const expirationUserId = "credit-cron-expiration-user";
    const persistedUserId = "credit-cron-persisted-user";
    await createUser({ id: refreshUserId, lastCreditRefreshAt: null });
    await createUser({
      currentCredits: 10,
      id: expirationUserId,
      lastCreditRefreshAt: now,
    });
    await db.insert(scheduledJobTable).values({
      type: SCHEDULED_JOB_TYPES.CREDIT_REFRESH_USER,
      dedupeKey: `credit-refresh:${persistedUserId}`,
      payload: { userId: persistedUserId },
      runAt: now,
    });
    await db.insert(creditTransactionTable).values({
      userId: expirationUserId,
      amount: 10,
      remainingAmount: 10,
      type: CREDIT_TRANSACTION_TYPE.MONTHLY_REFRESH,
      description: "Free monthly credits",
      expirationDate: now,
    });

    await expect(handleSchedulerCron({
      env,
      now,
    })).resolves.toBe(3);

    const persistedJobs = await db.query.scheduledJobTable.findMany({
      where: (table, { eq }) => eq(table.dedupeKey, `credit-refresh:${persistedUserId}`),
    });

    expect(persistedJobs).toHaveLength(0);
  });

  test("consumeCredits deducts FIFO from real active credit rows, includes permanent credits, and writes usage", async () => {
    const now = secondsDate(Date.now());
    const userId = "credit-consume-user";
    await createUser({ currentCredits: 20, id: userId });
    await db.insert(creditTransactionTable).values([
      {
        userId,
        amount: 5,
        remainingAmount: 5,
        type: CREDIT_TRANSACTION_TYPE.PURCHASE,
        description: "Old active credits",
        expirationDate: futureDate(35),
        createdAt: new Date(now.getTime() - 3_000),
      },
      {
        userId,
        amount: 100,
        remainingAmount: 100,
        type: CREDIT_TRANSACTION_TYPE.PURCHASE,
        description: "Expired credits",
        expirationDate: new Date(now.getTime() - dayInMs),
        createdAt: new Date(now.getTime() - 2_000),
      },
      {
        userId,
        amount: 7,
        remainingAmount: 7,
        type: CREDIT_TRANSACTION_TYPE.PURCHASE,
        description: "New active credits",
        expirationDate: futureDate(35),
        createdAt: new Date(now.getTime() - 1_000),
      },
      {
        userId,
        amount: 4,
        remainingAmount: 4,
        type: CREDIT_TRANSACTION_TYPE.PURCHASE,
        description: "Permanent credits",
        expirationDate: null,
        createdAt: now,
      },
    ]);

    await consumeCredits({
      userId,
      amount: 15,
      description: "Marketplace item",
      now,
    });

    const transactions = await db.query.creditTransactionTable.findMany({
      where: (table, { eq }) => eq(table.userId, userId),
      orderBy: (table, { asc }) => [asc(table.createdAt)],
    });
    const user = await db.query.userTable.findFirst({
      where: (table, { eq }) => eq(table.id, userId),
    });

    expect(user?.currentCredits).toBe(5);
    expect(transactions).toEqual([
      expect.objectContaining({
        description: "Old active credits",
        remainingAmount: 0,
      }),
      expect.objectContaining({
        description: "Expired credits",
        remainingAmount: 100,
      }),
      expect.objectContaining({
        description: "New active credits",
        remainingAmount: 0,
      }),
      expect.objectContaining({
        description: "Permanent credits",
        remainingAmount: 1,
      }),
      expect.objectContaining({
        amount: -15,
        description: "Marketplace item",
        remainingAmount: 0,
        type: CREDIT_TRANSACTION_TYPE.USAGE,
      }),
    ]);
  });

  test("consumeCredits uses transaction id as the deterministic FIFO tiebreaker", async () => {
    const now = secondsDate(Date.now());
    const userId = "credit-consume-tie-user";
    await createUser({ currentCredits: 10, id: userId });
    const insertedTransactions = await db.insert(creditTransactionTable).values([
      {
        userId,
        amount: 5,
        remainingAmount: 5,
        type: CREDIT_TRANSACTION_TYPE.PURCHASE,
        description: "Same-time credits A",
        expirationDate: futureDate(35),
        createdAt: now,
      },
      {
        userId,
        amount: 5,
        remainingAmount: 5,
        type: CREDIT_TRANSACTION_TYPE.PURCHASE,
        description: "Same-time credits B",
        expirationDate: futureDate(35),
        createdAt: now,
      },
    ]).returning();
    const [firstTransaction, secondTransaction] = insertedTransactions
      .toSorted((left, right) => left.id.localeCompare(right.id));

    await consumeCredits({
      userId,
      amount: 6,
      description: "Tie-breaker usage",
      now,
    });

    const transactions = await db.query.creditTransactionTable.findMany({
      where: (table, { eq }) => eq(table.userId, userId),
    });

    expect(transactions.find((transaction) => transaction.id === firstTransaction?.id)?.remainingAmount).toBe(0);
    expect(transactions.find((transaction) => transaction.id === secondTransaction?.id)?.remainingAmount).toBe(4);
  });

  test("credit refresh rewrites KV session contents with the new credit balance", async () => {
    const now = futureDate(35);
    const userId = "credit-session-refresh-user";
    await createUser({ currentCredits: 0, id: userId, lastCreditRefreshAt: null });
    const sessionKey = await seedSession({ userId });

    await refreshUserMonthlyCreditsIfDue({ userId, now });

    const rawSession = await env.NEXT_INC_CACHE_KV.get(sessionKey);
    const session = rawSession ? JSON.parse(rawSession) as KVSession : null;

    expect(session?.user.currentCredits).toBe(50);
    expect(new Date(session?.user.lastCreditRefreshAt ?? 0)).toEqual(now);
  });

  test("credit consumption rewrites KV session contents with the new credit balance", async () => {
    const now = secondsDate(Date.now());
    const userId = "credit-session-consume-user";
    await createUser({ currentCredits: 8, id: userId });
    await db.insert(creditTransactionTable).values({
      userId,
      amount: 8,
      remainingAmount: 8,
      type: CREDIT_TRANSACTION_TYPE.PURCHASE,
      description: "Session credits",
      expirationDate: futureDate(35),
      createdAt: now,
    });
    const sessionKey = await seedSession({ userId });

    await consumeCredits({
      userId,
      amount: 3,
      description: "Session spend",
      now,
    });

    const rawSession = await env.NEXT_INC_CACHE_KV.get(sessionKey);
    const session = rawSession ? JSON.parse(rawSession) as KVSession : null;

    expect(session?.user.currentCredits).toBe(5);
  });

  test("concurrent consumeCredits calls cannot double-spend the same remaining credits", async () => {
    const now = secondsDate(Date.now());
    const userId = "credit-consume-concurrent-user";
    await createUser({ currentCredits: 6, id: userId });
    await db.insert(creditTransactionTable).values({
      userId,
      amount: 6,
      remainingAmount: 6,
      type: CREDIT_TRANSACTION_TYPE.PURCHASE,
      description: "Concurrent credits",
      expirationDate: futureDate(35),
      createdAt: now,
    });

    const results = await Promise.allSettled([
      consumeCredits({ userId, amount: 4, description: "First spend", now }),
      consumeCredits({ userId, amount: 4, description: "Second spend", now }),
    ]);

    const user = await db.query.userTable.findFirst({
      where: (table, { eq }) => eq(table.id, userId),
    });
    const usageTransactions = await db.query.creditTransactionTable.findMany({
      where: (table, { eq }) => eq(table.type, CREDIT_TRANSACTION_TYPE.USAGE),
    });

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(user?.currentCredits).toBe(2);
    expect(usageTransactions).toHaveLength(1);
  });
});
