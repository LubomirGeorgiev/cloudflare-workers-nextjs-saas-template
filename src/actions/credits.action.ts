"use server";

import { z } from "zod";
import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { requireVerifiedEmail } from "@/utils/auth";
import {
  getCreditTransactions,
  addUserCredits,
  logTransaction,
  getCreditPackage,
} from "@/utils/credits";
import { CREDIT_TRANSACTION_TYPE } from "@/db/schema";
import { getStripe } from "@/lib/stripe";
import { MAX_TRANSACTIONS_PER_PAGE, CREDITS_EXPIRATION_YEARS, DISABLE_CREDIT_BILLING_SYSTEM } from "@/constants";
import ms from "ms";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import { updateAllSessionsOfUser } from "@/utils/kv-session";

const getTransactionsSchema = z.object({
  page: z.number().min(1, "Invalid page"),
  limit: z.number().min(1, "Invalid limit").max(
    MAX_TRANSACTIONS_PER_PAGE,
    `Limit cannot be greater than ${MAX_TRANSACTIONS_PER_PAGE}`
  ).default(MAX_TRANSACTIONS_PER_PAGE),
});

const createPaymentIntentSchema = z.object({
  packageId: z.string().min(1, "Package is required"),
});

const confirmPaymentSchema = z.object({
  packageId: z.string().min(1, "Package is required"),
  paymentIntentId: z.string().min(1, "Payment intent is required"),
});

export const getTransactions = actionClient
  .inputSchema(getTransactionsSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(async () => {
      const session = await requireVerifiedEmail();

      if (!session?.user?.id) {
        throw new ActionError("NOT_AUTHORIZED", "Unauthorized");
      }

      const result = await getCreditTransactions({
        userId: session.user.id,
        page: input.page,
        limit: input.limit,
      });

      return {
        transactions: result.transactions,
        pagination: {
          total: result.pagination.total,
          pages: result.pagination.pages,
          current: result.pagination.current,
        }
      };
    }, RATE_LIMITS.PURCHASE);
  });

export const createPaymentIntent = actionClient
  .inputSchema(createPaymentIntentSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(async () => {
      if (DISABLE_CREDIT_BILLING_SYSTEM) {
        throw new ActionError("FORBIDDEN", "Credit billing system is disabled");
      }

      const session = await requireVerifiedEmail();
      if (!session) {
        throw new ActionError("NOT_AUTHORIZED", "Unauthorized");
      }

      try {
        const creditPackage = getCreditPackage(input.packageId);
        if (!creditPackage) {
          throw new ActionError("BAD_REQUEST", "Invalid package");
        }

        const paymentIntent = await getStripe().paymentIntents.create({
          amount: creditPackage.price * 100,
          currency: 'usd',
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: 'never',
          },
          metadata: {
            userId: session.user.id,
            packageId: creditPackage.id,
            credits: creditPackage.credits.toString(),
          },
        });

        return { clientSecret: paymentIntent.client_secret };
      } catch (error) {
        if (error instanceof ActionError) {
          throw error;
        }

        console.error("Payment intent creation error:", error);
        throw new ActionError("INTERNAL_SERVER_ERROR", "Failed to create payment intent");
      }
    }, RATE_LIMITS.PURCHASE);
  });

export const confirmPayment = actionClient
  .inputSchema(confirmPaymentSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(async () => {
      if (DISABLE_CREDIT_BILLING_SYSTEM) {
        throw new ActionError("FORBIDDEN", "Credit billing system is disabled");
      }

      const session = await requireVerifiedEmail();
      if (!session) {
        throw new ActionError("NOT_AUTHORIZED", "Unauthorized");
      }

      try {
        const creditPackage = getCreditPackage(input.packageId);
        if (!creditPackage) {
          throw new ActionError("BAD_REQUEST", "Invalid package");
        }

        // Verify the payment intent
        const paymentIntent = await getStripe().paymentIntents.retrieve(input.paymentIntentId);

        if (paymentIntent.status !== 'succeeded') {
          throw new ActionError("BAD_REQUEST", "Payment not completed");
        }

        // Verify the payment intent metadata matches
        if (
          paymentIntent.metadata.userId !== session.user.id ||
          paymentIntent.metadata.packageId !== input.packageId ||
          parseInt(paymentIntent.metadata.credits) !== creditPackage.credits
        ) {
          throw new ActionError("BAD_REQUEST", "Invalid payment intent");
        }

        // Add credits and log transaction
        await addUserCredits(session.user.id, creditPackage.credits);
        await logTransaction({
          userId: session.user.id,
          amount: creditPackage.credits,
          description: `Purchased ${creditPackage.credits} credits`,
          type: CREDIT_TRANSACTION_TYPE.PURCHASE,
          expirationDate: new Date(Date.now() + ms(`${CREDITS_EXPIRATION_YEARS} years`)),
          paymentIntentId: paymentIntent?.id
        });

        // Update all KV sessions to reflect the new credit balance
        await updateAllSessionsOfUser(session.user.id);

        return { success: true };
      } catch (error) {
        if (error instanceof ActionError) {
          throw error;
        }

        console.error("Purchase error:", error);
        throw new ActionError("INTERNAL_SERVER_ERROR", "Failed to process payment");
      }
    }, RATE_LIMITS.PURCHASE);
  });
