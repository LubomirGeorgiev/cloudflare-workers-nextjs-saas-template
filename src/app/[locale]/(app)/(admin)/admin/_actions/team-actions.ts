"use server";

import { cancelTeamSubscriptionAsAdmin } from "@/lib/admin/team-billing-admin";
import { removeUserFromTeam } from "@/lib/admin/user-credentials";
import { actionClient } from "@/lib/safe-action";
import { applyTeamRename } from "@/lib/teams/teams";
import {
  cancelTeamSubscriptionSchema,
  removeTeamMemberSchema,
  setTeamNameSchema,
} from "@/schemas/admin-teams.schema";
import { requireAdmin } from "@/utils/auth";
import { revalidateAdminTeam, revalidateAdminTeamAndUser } from "./admin-revalidate";

// `applyTeamRename` is the member-facing rename minus the team-permission check, so staff and
// members cannot drift apart. No acting member here: an admin renames a team they are not in.
export const setTeamNameAction = actionClient
  .inputSchema(setTeamNameSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const renamed = await applyTeamRename({ ...input, actingUserId: null });
    revalidateAdminTeam(input.teamId);

    // Narrowed on purpose: the full row carries Stripe ids, and an action's result is serialized
    // to the browser.
    return { id: renamed.id, name: renamed.name, slug: renamed.slug };
  });

// `removeUserFromTeam` is the same service the user detail page removes a membership with, so the
// two admin surfaces cannot disagree about who may be removed (an owner may not).
export const removeTeamMemberAction = actionClient
  .inputSchema(removeTeamMemberSchema)
  .action(async ({ parsedInput: input }) => {
    const result = await removeUserFromTeam(input);
    revalidateAdminTeamAndUser(input);

    return result;
  });

// The same service the ban path cancels with, so staff cancelling one team and staff banning its
// owner cannot end up passing different Stripe parameters. Immediate, never at period end, and it
// never refunds — a refund is issued by hand in the Stripe dashboard.
export const cancelTeamSubscriptionAction = actionClient
  .inputSchema(cancelTeamSubscriptionSchema)
  .action(async ({ parsedInput: input }) => {
    const session = await requireAdmin();

    const result = await cancelTeamSubscriptionAsAdmin({
      teamId: input.teamId,
      reason: `Cancelled by staff ${session.userId}: ${input.reason}`,
    });
    revalidateAdminTeam(input.teamId);

    return result;
  });
