"use server";

import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { getSessionFromCookie } from "@/utils/auth";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import { hasEnoughCredits, consumeCredits } from "@/utils/credits";
import { getDB } from "@/db";
import { purchasedItemsTable, PURCHASABLE_ITEM_TYPE } from "@/db/schema";
import { COMPONENTS } from "@/app/(dashboard)/dashboard/marketplace/components-catalog";
import { DISABLE_CREDIT_BILLING_SYSTEM } from "@/constants";
import { v } from "@/lib/validation";
import { getTranslations } from "next-intl/server";

const purchaseSchema = v.object({
  itemId: v.string(),
  itemType: v.picklist([PURCHASABLE_ITEM_TYPE.COMPONENT]), // Add more types as they become available
});

export const purchaseAction = actionClient
  .inputSchema(purchaseSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(
      async () => {
        const t = await getTranslations("Client.Dashboard.Marketplace");

        if (DISABLE_CREDIT_BILLING_SYSTEM) {
          throw new ActionError(
            "INSUFFICIENT_CREDITS",
            t("errorBillingDisabled")
          );
        }

        const session = await getSessionFromCookie();

        if (!session) {
          throw new ActionError(
            "NOT_AUTHORIZED",
            t("errorNotLoggedIn")
          );
        }

        let itemDetails: { name: string; credits: number } | undefined;
        switch (input.itemType) {
          case PURCHASABLE_ITEM_TYPE.COMPONENT:
            itemDetails = COMPONENTS.find(c => c.id === input.itemId);
            break;
        }

        if (!itemDetails) {
          throw new ActionError(
            "NOT_FOUND",
            t("errorItemNotFound")
          );
        }

        const db = getDB();

        const existingPurchase = await db.query.purchasedItemsTable.findFirst({
          where: {
            userId: session.userId,
            itemType: input.itemType,
            itemId: input.itemId,
          },
        });

        if (existingPurchase) {
          throw new ActionError(
            "CONFLICT",
            t("errorAlreadyOwned")
          );
        }

        const hasCredits = await hasEnoughCredits({
          userId: session.userId,
          requiredCredits: itemDetails.credits,
        });

        if (!hasCredits) {
          throw new ActionError(
            "INSUFFICIENT_CREDITS",
            t("errorInsufficientCredits")
          );
        }

        // Use credits
        await consumeCredits({
          userId: session.userId,
          amount: itemDetails.credits,
          description: t("purchaseTransactionDescription", {
            itemType: input.itemType.toLowerCase(),
            itemName: itemDetails.name,
          }),
        });

        await db.insert(purchasedItemsTable).values({
          userId: session.userId,
          itemType: input.itemType,
          itemId: input.itemId,
        });

        return { success: true };
      },
      RATE_LIMITS.PURCHASE
    );
  });
