import "server-only";

import { and, eq, gt, isNull, lte, sql } from "drizzle-orm";

import { getDB } from "@/db";
import { creditTransactionTable, userTable } from "@/db/schema";
import { DISABLE_CREDIT_BILLING_SYSTEM } from "@/constants";
import {
  createScheduledQueueMessage,
  SCHEDULED_JOB_TYPES,
  type SchedulerQueue,
} from "@/lib/scheduler/jobs";
import { scheduleJob } from "@/lib/scheduler/scheduler";
import { getCloudflareContext } from "@/utils/cloudflare-context";
import {
  getNextCreditRefreshAt,
  getOneCalendarMonthBefore,
} from "@/utils/credit-periods";
import { updateAllSessionsOfUser } from "@/utils/kv-session";

const CREDIT_REFRESH_DEDUPE_PREFIX = "credit-refresh";
const CREDIT_EXPIRATION_DEDUPE_PREFIX = "credit-expiration";
const CREDIT_CRON_DISPATCH_LIMIT = 100;

function getCreditRefreshDedupeKey(userId: string): string {
  return `${CREDIT_REFRESH_DEDUPE_PREFIX}:${userId}`;
}

function getCreditExpirationDedupeKey(transactionId: string): string {
  return `${CREDIT_EXPIRATION_DEDUPE_PREFIX}:${transactionId}`;
}

async function getSchedulerQueue(): Promise<SchedulerQueue> {
  const { env } = await getCloudflareContext();
  return env.SCHEDULER_QUEUE;
}

export async function scheduleUserCreditRefresh({
  userId,
  lastCreditRefreshAt,
  now = new Date(),
}: {
  userId: string;
  lastCreditRefreshAt?: Date | null;
  now?: Date;
}): Promise<void> {
  if (DISABLE_CREDIT_BILLING_SYSTEM) {
    return;
  }

  const queue = await getSchedulerQueue();

  await scheduleJob({
    queue,
    type: SCHEDULED_JOB_TYPES.CREDIT_REFRESH_USER,
    dedupeKey: getCreditRefreshDedupeKey(userId),
    payload: { userId },
    runAt: getNextCreditRefreshAt({ lastCreditRefreshAt, now }),
  });
}

export async function scheduleCreditExpiration({
  transactionId,
  expirationDate,
}: {
  transactionId: string;
  expirationDate: Date;
}): Promise<void> {
  if (DISABLE_CREDIT_BILLING_SYSTEM) {
    return;
  }

  const queue = await getSchedulerQueue();

  await scheduleJob({
    queue,
    type: SCHEDULED_JOB_TYPES.CREDIT_EXPIRE_TRANSACTION,
    dedupeKey: getCreditExpirationDedupeKey(transactionId),
    payload: { transactionId },
    runAt: expirationDate,
  });
}

export async function processExpiredCreditTransactionIfDue({
  transactionId,
  now = new Date(),
}: {
  transactionId: string;
  now?: Date;
}): Promise<void> {
  if (DISABLE_CREDIT_BILLING_SYSTEM) {
    return;
  }

  const db = getDB();
  const transaction = await db.query.creditTransactionTable.findFirst({
    where: { id: transactionId },
  });

  if (!transaction) {
    return;
  }

  const [processedTransaction] = await db
    .update(creditTransactionTable)
    .set({
      expirationDateProcessedAt: now,
      remainingAmount: 0,
    })
    .where(and(
      eq(creditTransactionTable.id, transaction.id),
      eq(creditTransactionTable.remainingAmount, transaction.remainingAmount),
      isNull(creditTransactionTable.expirationDateProcessedAt),
      gt(creditTransactionTable.remainingAmount, 0),
      lte(creditTransactionTable.expirationDate, now),
    ))
    .returning({
      remainingAmount: creditTransactionTable.remainingAmount,
      userId: creditTransactionTable.userId,
    });

  if (!processedTransaction) {
    return;
  }

  const [updatedUser] = await db
    .update(userTable)
    .set({
      currentCredits: sql`${userTable.currentCredits} - ${transaction.remainingAmount}`,
    })
    .where(and(
      eq(userTable.id, processedTransaction.userId),
      sql`${userTable.currentCredits} >= ${transaction.remainingAmount}`,
    ))
    .returning({ currentCredits: userTable.currentCredits });

  if (updatedUser) {
    await updateAllSessionsOfUser(processedTransaction.userId);
  }
}

export async function dispatchDueCreditExpirationJobs({
  queue,
  now = new Date(),
  limit = CREDIT_CRON_DISPATCH_LIMIT,
}: {
  queue: SchedulerQueue;
  now?: Date;
  limit?: number;
}): Promise<number> {
  if (DISABLE_CREDIT_BILLING_SYSTEM) {
    return 0;
  }

  const db = getDB();
  const expiredTransactions = await db.query.creditTransactionTable.findMany({
    where: {
      expirationDate: { lte: now },
      expirationDateProcessedAt: { isNull: true },
      remainingAmount: { gt: 0 },
    },
    orderBy: { expirationDate: "asc" },
    limit,
  });

  for (const transaction of expiredTransactions) {
    await queue.send(createScheduledQueueMessage({
      type: SCHEDULED_JOB_TYPES.CREDIT_EXPIRE_TRANSACTION,
      payload: { transactionId: transaction.id },
      runAt: now,
    }));
  }

  return expiredTransactions.length;
}

export async function dispatchDueCreditRefreshJobs({
  queue,
  now = new Date(),
  limit = CREDIT_CRON_DISPATCH_LIMIT,
}: {
  queue: SchedulerQueue;
  now?: Date;
  limit?: number;
}): Promise<number> {
  if (DISABLE_CREDIT_BILLING_SYSTEM) {
    return 0;
  }

  const db = getDB();
  const oneMonthAgo = getOneCalendarMonthBefore(now);
  const usersDueForRefresh = await db.query.userTable.findMany({
    where: {
      OR: [
        { lastCreditRefreshAt: { isNull: true } },
        { lastCreditRefreshAt: { lte: oneMonthAgo } },
      ],
    },
    columns: {
      id: true,
    },
    orderBy: { lastCreditRefreshAt: "asc" },
    limit,
  });

  for (const user of usersDueForRefresh) {
    await queue.send(createScheduledQueueMessage({
      type: SCHEDULED_JOB_TYPES.CREDIT_REFRESH_USER,
      payload: { userId: user.id },
      runAt: now,
    }));
  }

  return usersDueForRefresh.length;
}
