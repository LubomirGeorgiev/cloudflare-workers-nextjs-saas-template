"use server";

import { EU_WITHDRAWAL_ENABLED } from "@/constants";
import { WITHDRAWAL_STALE_MESSAGE_KEY } from "@/constants/eu-withdrawal";
import { TEAM_PERMISSIONS } from "@/constants/team-roles";
import { getDB } from "@/db";
import { isBillingEnabled } from "@/flags";
import { getLocale } from "@/i18n/server";
import { ActionError } from "@/lib/action-error";
import { withdrawalSignerName, withdrawFromContract } from "@/lib/billing/eu-withdrawal";
import { actionClient } from "@/lib/safe-action";
import { withdrawFromContractSchema } from "@/schemas/billing.schema";
import { requireTeamPermission } from "@/utils/team-auth";
import { RATE_LIMITS, withRateLimit } from "@/utils/with-rate-limit";

const UNAVAILABLE_KEY = "Client.Dashboard.Billing.errorWithdrawalUnavailable";

// The EU withdrawal button. `completed: false` means the withdrawal is recorded, and the resume
// job finishes the rest (`src/lib/billing/eu-withdrawal.ts`).
export const withdrawFromContractAction = actionClient
  .metadata({ actionName: "withdrawFromContractAction" })
  .inputSchema(withdrawFromContractSchema)
  .action(async ({ parsedInput: { teamId, subscriptionId } }) => {
    return withRateLimit(async () => {
      if (!EU_WITHDRAWAL_ENABLED || !isBillingEnabled()) {
        throw new ActionError("PRECONDITION_FAILED", { key: UNAVAILABLE_KEY });
      }

      const session = await requireTeamPermission(teamId, TEAM_PERMISSIONS.ACCESS_BILLING);
      const team = await getDB().query.teamTable.findFirst({
        where: { id: teamId },
        columns: { id: true, name: true, subscriptionPlanId: true, stripeSubscriptionId: true },
      });
      const { email } = session.user;
      // The receipt goes to the user who withdrew; without an address there is nowhere to send it.
      if (!team?.stripeSubscriptionId || !email) {
        throw new ActionError("PRECONDITION_FAILED", { key: UNAVAILABLE_KEY });
      }
      // A dialog from before a new checkout must not withdraw from the contract that replaced it.
      if (team.stripeSubscriptionId !== subscriptionId) {
        throw new ActionError("CONFLICT", { key: WITHDRAWAL_STALE_MESSAGE_KEY });
      }

      try {
        return await withdrawFromContract({
          team,
          subscriptionId: team.stripeSubscriptionId,
          actingUser: {
            id: session.user.id,
            name: withdrawalSignerName({ firstName: session.user.firstName, lastName: session.user.lastName, email }),
            email,
            locale: await getLocale(),
          },
          now: new Date(),
        });
      } catch (error) {
        if (error instanceof ActionError) {
          throw error;
        }
        console.error("withdrawFromContractAction failed", error);
        throw new ActionError("INTERNAL_SERVER_ERROR", { key: "Client.Dashboard.Billing.errorPaymentProvider" });
      }
    }, RATE_LIMITS.BILLING);
  });
