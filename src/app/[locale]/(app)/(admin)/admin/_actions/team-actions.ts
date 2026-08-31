"use server";

import { removeUserFromTeam } from "@/lib/admin/user-credentials";
import { actionClient } from "@/lib/safe-action";
import { applyTeamRename } from "@/lib/teams/teams";
import { removeTeamMemberSchema, setTeamNameSchema } from "@/schemas/admin-teams.schema";
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
