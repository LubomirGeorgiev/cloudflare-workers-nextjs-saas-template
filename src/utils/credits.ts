import "server-only";
import { eq, sql, desc, and, lt, isNull, gt, or, asc } from "drizzle-orm";
import { getDB } from "@/db";
import { userTable, creditTransactionTable, CREDIT_TRANSACTION_TYPE, purchasedItemsTable } from "@/db/schema";
import { updateAllSessionsOfUser, KVSession } from "./kv-session";
import { CREDIT_PACKAGES, FREE_MONTHLY_CREDITS, DISABLE_CREDIT_BILLING_SYSTEM } from "@/constants";

export type CreditPackage = typeof CREDIT_PACKAGES[number];

export function getCreditPackage(packageId: string): CreditPackage | undefined {
  return CREDIT_PACKAGES.find((pkg) => pkg.id === packageId);
}

function shouldRefreshCredits(session: KVSession, currentTime: Date): boolean {
  // Check if it's been at least a month since last refresh
  if (!session.user.lastCreditRefreshAt) {
    return true;
  }

  // Calculate the date exactly one month after the last refresh
  const oneMonthAfterLastRefresh = new Date(session.user.lastCreditRefreshAt);
  oneMonthAfterLastRefresh.setMonth(oneMonthAfterLastRefresh.getMonth() + 1);

  // Only refresh if we've passed the one month mark
  return currentTime >= oneMonthAfterLastRefresh;
}

async function processExpiredCredits(userId: string, currentTime: Date) {
  if (DISABLE_CREDIT_BILLING_SYSTEM) {
    return;
  }

  const db = getDB();
  // Find all expired transactions that haven't been processed and have remaining credits
  // Order by type to process MONTHLY_REFRESH first, then by creation date
  const expiredTransactions = await db.query.creditTransactionTable.findMany({
    where: and(
      eq(creditTransactionTable.userId, userId),
      lt(creditTransactionTable.expirationDate, currentTime),
      isNull(creditTransactionTable.expirationDateProcessedAt),
      gt(creditTransactionTable.remainingAmount, 0),
    ),
    orderBy: [
      // Process MONTHLY_REFRESH transactions first
      desc(sql`CASE WHEN ${creditTransactionTable.type} = ${CREDIT_TRANSACTION_TYPE.MONTHLY_REFRESH} THEN 1 ELSE 0 END`),
      // Then process by creation date (oldest first)
      asc(creditTransactionTable.createdAt),
    ],
  });

  // Process each expired transaction
  for (const transaction of expiredTransactions) {
    try {
      // Atomically mark the transaction as processed ONLY if it hasn't been processed yet
      // This prevents race conditions where multiple requests try to process the same transaction
      const updateResult = await db
        .update(creditTransactionTable)
        .set({
          expirationDateProcessedAt: currentTime,
          remainingAmount: 0, // All remaining credits are expired
        })
        .where(and(
          eq(creditTransactionTable.id, transaction.id),
          isNull(creditTransactionTable.expirationDateProcessedAt),
          eq(creditTransactionTable.remainingAmount, transaction.remainingAmount)
        ))
        .returning({ id: creditTransactionTable.id });

      // If no rows were updated, another request already processed this transaction
      if (!updateResult || updateResult.length === 0) {
        continue;
      }

      // Then deduct the expired credits from user's balance
      await db
        .update(userTable)
        .set({
          currentCredits: sql`${userTable.currentCredits} - ${transaction.remainingAmount}`,
        })
        .where(eq(userTable.id, userId));
    } catch (error) {
      console.error(`Failed to process expired credits for transaction ${transaction.id}:`, error);
      continue;
    }
  }
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
  await db.insert(creditTransactionTable).values({
    userId,
    amount,
    remainingAmount: amount, // Initialize remaining amount to be the same as amount
    type,
    description,
    expirationDate,
    paymentIntentId
  });
}

export async function addFreeMonthlyCreditsIfNeeded(session: KVSession): Promise<number> {
  if (DISABLE_CREDIT_BILLING_SYSTEM) {
    return 0;
  }

  const currentTime = new Date();

  // Check if it's been at least a month since last refresh
  if (shouldRefreshCredits(session, currentTime)) {
    // Double check the last refresh date from the database to prevent race conditions
    const db = getDB();
    const user = await db.query.userTable.findFirst({
      where: eq(userTable.id, session.userId),
      columns: {
        lastCreditRefreshAt: true,
        currentCredits: true,
      },
    });

    // This should prevent race conditions between multiple sessions
    if (!shouldRefreshCredits({ ...session, user: { ...session.user, lastCreditRefreshAt: user?.lastCreditRefreshAt ?? null } }, currentTime)) {
      return user?.currentCredits ?? 0;
    }

    // Calculate one month ago from current time (using calendar month logic)
    const oneMonthAgo = new Date(currentTime);
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

    // Update last refresh date FIRST to act as a distributed lock
    // This prevents race conditions where multiple requests try to add credits simultaneously
    const updateResult = await db
      .update(userTable)
      .set({
        lastCreditRefreshAt: currentTime,
      })
      .where(and(
        eq(userTable.id, session.userId),
        or(
          isNull(userTable.lastCreditRefreshAt),
          lt(userTable.lastCreditRefreshAt, oneMonthAgo) // More than 1 calendar month ago
        )
      ))
      .returning({ lastCreditRefreshAt: userTable.lastCreditRefreshAt });

    // If no rows were updated, another request already processed the refresh
    if (!updateResult || updateResult.length === 0) {
      const currentUser = await db.query.userTable.findFirst({
        where: eq(userTable.id, session.userId),
        columns: {
          currentCredits: true,
        },
      });
      return currentUser?.currentCredits ?? 0;
    }

    // Process any expired credits first
    await processExpiredCredits(session.userId, currentTime);

    // Add free monthly credits with 1 month expiration
    const expirationDate = new Date(currentTime);
    expirationDate.setMonth(expirationDate.getMonth() + 1);

    await addUserCredits(session.userId, FREE_MONTHLY_CREDITS);
    await logTransaction({
      userId: session.userId,
      amount: FREE_MONTHLY_CREDITS,
      description: 'Free monthly credits',
      type: CREDIT_TRANSACTION_TYPE.MONTHLY_REFRESH,
      expirationDate
    });

    // Update all KV sessions to reflect the new credit balance and lastCreditRefreshAt
    await updateAllSessionsOfUser(session.userId);

    // Get the updated credit balance from the database
    const updatedUser = await db.query.userTable.findFirst({
      where: eq(userTable.id, session.userId),
      columns: {
        currentCredits: true,
      },
    });

    return updatedUser?.currentCredits ?? 0;
  }

  return session.user.currentCredits;
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

export async function consumeCredits({ userId, amount, description }: { userId: string; amount: number; description: string }) {
  if (DISABLE_CREDIT_BILLING_SYSTEM) {
    return 0;
  }

  const db = getDB();

  // First check if user has enough credits
  const user = await db.query.userTable.findFirst({
    where: eq(userTable.id, userId),
    columns: {
      currentCredits: true,
    },
  });

  if (!user || user.currentCredits < amount) {
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
        gt(creditTransactionTable.expirationDate, new Date())
      )
    ),
    orderBy: [asc(creditTransactionTable.createdAt)],
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
    createdAt: new Date(),
    updatedAt: new Date(),
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
