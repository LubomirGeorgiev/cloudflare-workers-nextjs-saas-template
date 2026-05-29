import "server-only";
import { eq, sql, desc, and, lte, isNull, gt, or, asc } from "drizzle-orm";
import { getDB } from "@/db";
import {
  userTable,
  creditTransactionTable,
  CREDIT_TRANSACTION_TYPE,
  purchasedItemsTable,
} from "@/db/schema";
import { updateAllSessionsOfUser } from "./kv-session";
import { CREDIT_PACKAGES, FREE_MONTHLY_CREDITS, DISABLE_CREDIT_BILLING_SYSTEM } from "@/constants";
import {
  getOneCalendarMonthAfter,
  getOneCalendarMonthBefore,
  shouldRefreshCreditsFromDate,
} from "@/utils/credit-periods";
import {
  scheduleCreditExpiration,
  scheduleUserCreditRefresh,
} from "@/utils/credit-scheduler";

type CreditPackage = typeof CREDIT_PACKAGES[number];

export function getCreditPackage(packageId: string): CreditPackage | undefined {
  return CREDIT_PACKAGES.find((pkg) => pkg.id === packageId);
}

export async function addUserCredits(userId: string, creditsToAdd: number) {
  if (DISABLE_CREDIT_BILLING_SYSTEM) {
    return;
  }

  const db = getDB();
  await db
    .update(userTable)
    .set({
      currentCredits: sql`${userTable.currentCredits} + ${creditsToAdd}`,
    })
    .where(eq(userTable.id, userId));
}

export async function logTransaction({
  userId,
  amount,
  description,
  type,
  expirationDate,
  paymentIntentId
}: {
  userId: string;
  amount: number;
  description: string;
  type: keyof typeof CREDIT_TRANSACTION_TYPE;
  expirationDate?: Date;
  paymentIntentId?: string;
}) {
  if (DISABLE_CREDIT_BILLING_SYSTEM) {
    return;
  }

  const db = getDB();
  const [transaction] = await db.insert(creditTransactionTable).values({
    userId,
    amount,
    remainingAmount: amount, // Initialize remaining amount to be the same as amount
    type,
    description,
    expirationDate,
    paymentIntentId
  }).returning();

  if (transaction?.expirationDate && transaction.remainingAmount > 0) {
    await scheduleCreditExpiration({
      transactionId: transaction.id,
      expirationDate: transaction.expirationDate,
    });
  }

  return transaction;
}

export async function refreshUserMonthlyCreditsIfDue({
  userId,
  now = new Date(),
}: {
  userId: string;
  now?: Date;
}): Promise<void> {
  if (DISABLE_CREDIT_BILLING_SYSTEM) {
    return;
  }

  const db = getDB();
  const user = await db.query.userTable.findFirst({
    where: eq(userTable.id, userId),
    columns: {
      lastCreditRefreshAt: true,
      currentCredits: true,
    },
  });

  if (!user) {
    return;
  }

  if (!shouldRefreshCreditsFromDate(user.lastCreditRefreshAt, now)) {
    await scheduleUserCreditRefresh({
      userId,
      lastCreditRefreshAt: user.lastCreditRefreshAt,
      now,
    });

    return;
  }

  const oneMonthAgo = getOneCalendarMonthBefore(now);
  const updateResult = await db
    .update(userTable)
    .set({
      lastCreditRefreshAt: now,
    })
    .where(and(
      eq(userTable.id, userId),
      or(
        isNull(userTable.lastCreditRefreshAt),
        lte(userTable.lastCreditRefreshAt, oneMonthAgo)
      )
    ))
    .returning({ lastCreditRefreshAt: userTable.lastCreditRefreshAt });

  if (!updateResult[0]) {
    return;
  }

  const expirationDate = getOneCalendarMonthAfter(now);

  await addUserCredits(userId, FREE_MONTHLY_CREDITS);
  await logTransaction({
    userId,
    amount: FREE_MONTHLY_CREDITS,
    description: "Free monthly credits",
    type: CREDIT_TRANSACTION_TYPE.MONTHLY_REFRESH,
    expirationDate,
  });

  await updateAllSessionsOfUser(userId);
  await scheduleUserCreditRefresh({
    userId,
    lastCreditRefreshAt: now,
    now,
  });
}

export async function hasEnoughCredits({ userId, requiredCredits }: { userId: string; requiredCredits: number }) {
  if (DISABLE_CREDIT_BILLING_SYSTEM) {
    return true;
  }

  const user = await getDB().query.userTable.findFirst({
    where: eq(userTable.id, userId),
    columns: {
      currentCredits: true,
    }
  });
  if (!user) return false;

  return user.currentCredits >= requiredCredits;
}

export async function consumeCredits({
  userId,
  amount,
  description,
  now,
}: {
  userId: string;
  amount: number;
  description: string;
  now?: Date;
}) {
  if (DISABLE_CREDIT_BILLING_SYSTEM) {
    return 0;
  }

  const db = getDB();
  const currentTime = now ?? new Date();

  // First check if user has enough credits
  const hasCredits = await hasEnoughCredits({ userId, requiredCredits: amount });
  if (!hasCredits) {
    throw new Error("Insufficient credits");
  }

  // Get all non-expired transactions with remaining credits, ordered by creation date
  const activeTransactionsWithBalance = await db.query.creditTransactionTable.findMany({
    where: and(
      eq(creditTransactionTable.userId, userId),
      gt(creditTransactionTable.remainingAmount, 0),
      isNull(creditTransactionTable.expirationDateProcessedAt),
      or(
        isNull(creditTransactionTable.expirationDate),
        gt(creditTransactionTable.expirationDate, currentTime)
      )
    ),
    orderBy: [asc(creditTransactionTable.createdAt), asc(creditTransactionTable.id)],
  });

  let remainingToDeduct = amount;
  let actuallyDeducted = 0;

  // Deduct from each transaction until we've deducted the full amount
  for (const transaction of activeTransactionsWithBalance) {
    if (remainingToDeduct <= 0) break;

    const deductFromThis = Math.min(transaction.remainingAmount, remainingToDeduct);
    const newRemainingAmount = transaction.remainingAmount - deductFromThis;

    // Atomically update ONLY if the remainingAmount hasn't changed
    // This prevents race conditions where multiple requests try to deduct from the same transaction
    const updateResult = await db
      .update(creditTransactionTable)
      .set({
        remainingAmount: newRemainingAmount,
      })
      .where(and(
        eq(creditTransactionTable.id, transaction.id),
        eq(creditTransactionTable.remainingAmount, transaction.remainingAmount)
      ))
      .returning({ remainingAmount: creditTransactionTable.remainingAmount });

    // If the update succeeded, count the deduction
    if (updateResult && updateResult.length > 0) {
      actuallyDeducted += deductFromThis;
      remainingToDeduct -= deductFromThis;
    }
    // If update failed, another request modified this transaction, re-fetch and continue
  }

  // Verify we were able to deduct the full amount
  if (actuallyDeducted < amount) {
    throw new Error("Insufficient credits - concurrent modification detected");
  }

  // Update total credits using SQL to ensure atomicity and prevent negative balance
  const userUpdateResult = await db
    .update(userTable)
    .set({
      currentCredits: sql`${userTable.currentCredits} - ${amount}`,
    })
    .where(and(
      eq(userTable.id, userId),
      sql`${userTable.currentCredits} >= ${amount}` // Ensure we don't go negative
    ))
    .returning({ currentCredits: userTable.currentCredits });

  // If no rows were updated, we don't have enough credits (race condition)
  if (!userUpdateResult || userUpdateResult.length === 0) {
    throw new Error("Insufficient credits");
  }

  // Log the usage transaction
  await db.insert(creditTransactionTable).values({
    userId,
    amount: -amount,
    remainingAmount: 0, // Usage transactions don't have remaining amount
    type: CREDIT_TRANSACTION_TYPE.USAGE,
    description,
    createdAt: currentTime,
    updatedAt: currentTime,
  });

  // Update all KV sessions to reflect the new credit balance
  await updateAllSessionsOfUser(userId);

  return userUpdateResult[0].currentCredits;
}

export async function getCreditTransactions({
  userId,
  page = 1,
  limit = 10
}: {
  userId: string;
  page?: number;
  limit?: number;
}) {
  if (DISABLE_CREDIT_BILLING_SYSTEM) {
    return {
      transactions: [],
      pagination: {
        total: 0,
        pages: 0,
        current: page,
      },
    };
  }

  const db = getDB();
  const transactions = await db.query.creditTransactionTable.findMany({
    where: eq(creditTransactionTable.userId, userId),
    orderBy: [desc(creditTransactionTable.createdAt)],
    limit,
    offset: (page - 1) * limit,
    columns: {
      expirationDateProcessedAt: false,
      remainingAmount: false,
      userId: false,
    }
  });

  const total = await db
    .select({ count: sql<number>`count(*)` })
    .from(creditTransactionTable)
    .where(eq(creditTransactionTable.userId, userId))
    .then((result) => result[0].count);

  return {
    transactions,
    pagination: {
      total,
      pages: Math.ceil(total / limit),
      current: page,
    },
  };
}

export async function getUserPurchasedItems(userId: string) {
  const db = getDB();
  const purchasedItems = await db.query.purchasedItemsTable.findMany({
    where: eq(purchasedItemsTable.userId, userId),
  });

  // Create a map of purchased items for easy lookup
  return new Set(
    purchasedItems.map(item => `${item.itemType}:${item.itemId}`)
  );
}
