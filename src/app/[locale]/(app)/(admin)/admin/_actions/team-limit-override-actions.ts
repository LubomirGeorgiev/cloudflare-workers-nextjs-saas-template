"use server";

import { setTeamLimitOverridesAsStaff } from "@/lib/admin/team-limit-overrides";
import { actionClient } from "@/lib/safe-action";
import { limitOverridesFromForm, setTeamLimitOverridesSchema } from "@/schemas/limit-overrides.schema";
import { requireAdmin } from "@/utils/auth";
import { revalidateAdminTeam } from "./admin-revalidate";

// The service is not self-authorizing, so the action checks the admin first.

export const setTeamLimitOverridesAction = actionClient
  .metadata({ actionName: "setTeamLimitOverridesAction" })
  .inputSchema(setTeamLimitOverridesSchema)
  .action(async ({ parsedInput: { teamId, reason, hideFromCustomer, ...limits } }) => {
    const session = await requireAdmin();

    const view = await setTeamLimitOverridesAsStaff({
      teamId,
      overrides: limitOverridesFromForm(limits),
      hideFromCustomer,
      reason,
      staffUserId: session.userId,
    });
    revalidateAdminTeam(teamId);

    return { overrides: view.overrides, hideFromCustomer: view.hideFromCustomer };
  });
