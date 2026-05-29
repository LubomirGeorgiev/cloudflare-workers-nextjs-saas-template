import { afterEach, describe, expect, test, vi } from "vitest";
import { DISABLE_CREDIT_BILLING_SYSTEM } from "@/constants";

const describeCreditBilling = DISABLE_CREDIT_BILLING_SYSTEM
  ? describe.skip
  : describe;

const describeDisabledCreditBilling = DISABLE_CREDIT_BILLING_SYSTEM
  ? describe
  : describe.skip;

const {
  getDBMock,
  scheduleCreditExpirationMock,
  scheduleUserCreditRefreshMock,
  updateAllSessionsOfUserMock,
} = vi.hoisted(() => ({
  getDBMock: vi.fn(),
  scheduleCreditExpirationMock: vi.fn(),
  scheduleUserCreditRefreshMock: vi.fn(),
  updateAllSessionsOfUserMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/db", () => ({
  getDB: getDBMock,
}));

vi.mock("@/utils/credit-scheduler", () => ({
  scheduleCreditExpiration: scheduleCreditExpirationMock,
  scheduleUserCreditRefresh: scheduleUserCreditRefreshMock,
}));

vi.mock("@/utils/kv-session", () => ({
  updateAllSessionsOfUser: updateAllSessionsOfUserMock,
}));

const {
  consumeCredits,
  logTransaction,
  refreshUserMonthlyCreditsIfDue,
} = await import("@/utils/credits");

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

describeCreditBilling("monthly credit refresh", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  test("reschedules without adding credits before the next monthly boundary", async () => {
    const lastCreditRefreshAt = new Date(2026, 3, 29, 10, 0, 0, 0);
    const now = new Date(2026, 4, 29, 9, 59, 59, 999);
    const db = {
      query: {
        userTable: {
          findFirst: vi.fn(async () => ({
            currentCredits: 0,
            lastCreditRefreshAt,
          })),
        },
      },
      update: vi.fn(),
      insert: vi.fn(),
    };
    getDBMock.mockReturnValue(db);

    await refreshUserMonthlyCreditsIfDue({ userId: "user-1", now });

    expect(scheduleUserCreditRefreshMock).toHaveBeenCalledWith({
      userId: "user-1",
      lastCreditRefreshAt,
      now,
    });
    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(updateAllSessionsOfUserMock).not.toHaveBeenCalled();
  });

  test("claims refreshes inclusively at the exact monthly boundary", async () => {
    const lastCreditRefreshAt = new Date(2026, 3, 29, 10, 0, 0, 0);
    const now = new Date(2026, 4, 29, 10, 0, 0, 0);
    const whereMock = vi.fn((__condition: unknown) => ({
      returning: vi.fn(async () => []),
    }));
    const db = {
      query: {
        userTable: {
          findFirst: vi.fn(async () => ({
            currentCredits: 0,
            lastCreditRefreshAt,
          })),
        },
      },
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: whereMock,
        })),
      })),
    };
    getDBMock.mockReturnValue(db);

    await refreshUserMonthlyCreditsIfDue({ userId: "user-1", now });

    expect(db.update).toHaveBeenCalledOnce();
    expect(getSqlText(whereMock.mock.calls[0]?.[0])).toContain(" <= ");
  });

  test("refreshes users with no prior refresh and schedules all monthly follow-up work", async () => {
    const now = new Date(2026, 4, 29, 10, 0, 0, 0);
    const expirationDate = new Date(2026, 5, 29, 10, 0, 0, 0);
    const userUpdateReturning = vi.fn(async () => [{ lastCreditRefreshAt: now }]);
    const refreshClaimWhere = vi.fn((__condition: unknown) => ({
      returning: userUpdateReturning,
    }));
    const addCreditsWhere = vi.fn(async (__condition: unknown) => undefined);
    const updateMock = vi.fn()
      .mockReturnValueOnce({
        set: vi.fn(() => ({
          where: refreshClaimWhere,
        })),
      })
      .mockReturnValueOnce({
        set: vi.fn(() => ({
          where: addCreditsWhere,
        })),
      });
    const valuesMock = vi.fn((transaction: { expirationDate?: Date; remainingAmount?: number }) => ({
      returning: vi.fn(async () => [{
        ...transaction,
        id: "monthly-transaction-1",
        expirationDate: transaction.expirationDate,
        remainingAmount: transaction.remainingAmount ?? 50,
      }]),
    }));
    const insertMock = vi.fn(() => ({
      values: valuesMock,
    }));
    const db = {
      query: {
        userTable: {
          findFirst: vi.fn(async () => ({
            currentCredits: 25,
            lastCreditRefreshAt: null,
          })),
        },
      },
      update: updateMock,
      insert: insertMock,
    };
    getDBMock.mockReturnValue(db);

    await refreshUserMonthlyCreditsIfDue({ userId: "user-1", now });

    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(getSqlText(refreshClaimWhere.mock.calls[0]?.[0])).toContain("is null");
    expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      amount: 50,
      remainingAmount: 50,
      type: "MONTHLY_REFRESH",
      description: "Free monthly credits",
      expirationDate,
    }));
    expect(scheduleCreditExpirationMock).toHaveBeenCalledWith({
      transactionId: "monthly-transaction-1",
      expirationDate,
    });
    expect(updateAllSessionsOfUserMock).toHaveBeenCalledWith("user-1");
    expect(scheduleUserCreditRefreshMock).toHaveBeenCalledWith({
      userId: "user-1",
      lastCreditRefreshAt: now,
      now,
    });
  });
});

describeCreditBilling("credit transactions", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  test("logTransaction schedules expiration only for positive remaining expiring transactions", async () => {
    const expirationDate = new Date(2026, 5, 29, 10, 0, 0, 0);
    const valuesMock = vi.fn()
      .mockReturnValueOnce({
        returning: vi.fn(async () => [{
          id: "transaction-positive",
          expirationDate,
          remainingAmount: 25,
        }]),
      })
      .mockReturnValueOnce({
        returning: vi.fn(async () => [{
          id: "transaction-empty",
          expirationDate,
          remainingAmount: 0,
        }]),
      })
      .mockReturnValueOnce({
        returning: vi.fn(async () => [{
          id: "transaction-permanent",
          expirationDate: null,
          remainingAmount: 25,
        }]),
      });
    getDBMock.mockReturnValue({
      insert: vi.fn(() => ({
        values: valuesMock,
      })),
    });

    await logTransaction({
      userId: "user-1",
      amount: 25,
      description: "Purchased credits",
      type: "PURCHASE",
      expirationDate,
    });
    await logTransaction({
      userId: "user-1",
      amount: 0,
      description: "No remaining credits",
      type: "PURCHASE",
      expirationDate,
    });
    await logTransaction({
      userId: "user-1",
      amount: 25,
      description: "Permanent credits",
      type: "PURCHASE",
    });

    expect(scheduleCreditExpirationMock).toHaveBeenCalledOnce();
    expect(scheduleCreditExpirationMock).toHaveBeenCalledWith({
      transactionId: "transaction-positive",
      expirationDate,
    });
  });
});

describeCreditBilling("consumeCredits", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  test("deducts FIFO from active credits, ignores expired credits, writes usage, and updates sessions", async () => {
    const now = new Date(2026, 4, 29, 10, 0, 0, 0);
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const user = {
      id: "user-1",
      currentCredits: 15,
    };
    const transactions = [
      {
        id: "old-active",
        userId: user.id,
        remainingAmount: 5,
        expirationDate: new Date(2026, 5, 29, 10, 0, 0, 0),
        expirationDateProcessedAt: null,
        createdAt: new Date(2026, 0, 1, 10, 0, 0, 0),
      },
      {
        id: "expired",
        userId: user.id,
        remainingAmount: 100,
        expirationDate: new Date(2026, 3, 29, 10, 0, 0, 0),
        expirationDateProcessedAt: null,
        createdAt: new Date(2026, 1, 1, 10, 0, 0, 0),
      },
      {
        id: "new-active",
        userId: user.id,
        remainingAmount: 7,
        expirationDate: new Date(2026, 6, 29, 10, 0, 0, 0),
        expirationDateProcessedAt: null,
        createdAt: new Date(2026, 2, 1, 10, 0, 0, 0),
      },
      {
        id: "permanent",
        userId: user.id,
        remainingAmount: 4,
        expirationDate: null,
        expirationDateProcessedAt: null,
        createdAt: new Date(2026, 3, 1, 10, 0, 0, 0),
      },
    ];
    const insertedTransactions: unknown[] = [];
    let deductionOrder = transactions;
    let transactionUpdateIndex = 0;
    const db = {
      query: {
        userTable: {
          findFirst: vi.fn(async () => ({
            currentCredits: user.currentCredits,
          })),
        },
        creditTransactionTable: {
          findMany: vi.fn(async () => {
            deductionOrder = transactions
              .filter((transaction) => transaction.remainingAmount > 0)
              .filter((transaction) => !transaction.expirationDateProcessedAt)
              .filter((transaction) => !transaction.expirationDate || transaction.expirationDate > now)
              .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());

            return deductionOrder;
          }),
        },
      },
      update: vi.fn(() => ({
        set: vi.fn((values: { remainingAmount?: number; currentCredits?: unknown }) => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => {
              if ("remainingAmount" in values) {
                const transaction = deductionOrder[transactionUpdateIndex];
                transactionUpdateIndex += 1;

                if (!transaction) {
                  return [];
                }

                transaction.remainingAmount = values.remainingAmount ?? transaction.remainingAmount;

                return [{ remainingAmount: transaction.remainingAmount }];
              }

              if (user.currentCredits < 9) {
                return [];
              }

              user.currentCredits -= 9;

              return [{ currentCredits: user.currentCredits }];
            }),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn(async (transaction: unknown) => {
          insertedTransactions.push(transaction);
        }),
      })),
    };
    getDBMock.mockReturnValue(db);

    await expect(consumeCredits({
      userId: user.id,
      amount: 9,
      description: "Marketplace item",
    })).resolves.toBe(6);

    expect(transactions.find((transaction) => transaction.id === "old-active")?.remainingAmount).toBe(0);
    expect(transactions.find((transaction) => transaction.id === "expired")?.remainingAmount).toBe(100);
    expect(transactions.find((transaction) => transaction.id === "new-active")?.remainingAmount).toBe(3);
    expect(transactions.find((transaction) => transaction.id === "permanent")?.remainingAmount).toBe(4);
    expect(insertedTransactions).toEqual([expect.objectContaining({
      userId: user.id,
      amount: -9,
      remainingAmount: 0,
      type: "USAGE",
      description: "Marketplace item",
      createdAt: now,
      updatedAt: now,
    })]);
    expect(updateAllSessionsOfUserMock).toHaveBeenCalledWith(user.id);
  });

  test("rejects usage before the balance can go negative", async () => {
    const db = {
      query: {
        userTable: {
          findFirst: vi.fn(async () => ({
            currentCredits: 8,
          })),
        },
      },
      update: vi.fn(),
      insert: vi.fn(),
    };
    getDBMock.mockReturnValue(db);

    await expect(consumeCredits({
      userId: "user-1",
      amount: 9,
      description: "Too expensive",
    })).rejects.toThrow("Insufficient credits");

    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(updateAllSessionsOfUserMock).not.toHaveBeenCalled();
  });
});

describeDisabledCreditBilling("disabled credit billing", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("credit operations are no-ops", async () => {
    await expect(refreshUserMonthlyCreditsIfDue({
      userId: "user-1",
    })).resolves.toBeUndefined();

    await expect(logTransaction({
      userId: "user-1",
      amount: 25,
      description: "Purchased credits",
      type: "PURCHASE",
    })).resolves.toBeUndefined();

    await expect(consumeCredits({
      userId: "user-1",
      amount: 10,
      description: "Marketplace item",
    })).resolves.toBe(0);

    expect(getDBMock).not.toHaveBeenCalled();
    expect(scheduleCreditExpirationMock).not.toHaveBeenCalled();
    expect(scheduleUserCreditRefreshMock).not.toHaveBeenCalled();
    expect(updateAllSessionsOfUserMock).not.toHaveBeenCalled();
  });
});
