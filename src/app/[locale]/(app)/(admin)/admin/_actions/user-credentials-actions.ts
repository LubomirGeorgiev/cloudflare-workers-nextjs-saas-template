"use server";

import {
  removeUserFromTeam,
  revokeUserApiKey,
  revokeUserConnectedApp,
} from "@/lib/admin/user-credentials";
import { actionClient } from "@/lib/safe-action";
import {
  removeUserFromTeamSchema,
  revokeUserApiKeySchema,
  revokeUserConnectedAppSchema,
} from "@/schemas/admin-users.schema";
import { revalidateAdminTeamAndUser, revalidateAdminUser } from "./admin-revalidate";

// A connected app renders on the user page alone; a membership and a team-scoped API key also
// render on the team page, and the team page revokes through these same actions. So the two-page
// rule lives in `./admin-revalidate.ts` and both action files apply it.

export const revokeUserConnectedAppAction = actionClient
  .inputSchema(revokeUserConnectedAppSchema)
  .action(async ({ parsedInput: input }) => {
    const result = await revokeUserConnectedApp(input);
    revalidateAdminUser(input.userId);

    return result;
  });

export const revokeUserApiKeyAction = actionClient
  .inputSchema(revokeUserApiKeySchema)
  .action(async ({ parsedInput: input }) => {
    const result = await revokeUserApiKey(input);
    revalidateAdminTeamAndUser({ teamId: result.teamId, userId: input.userId });

    return result;
  });

export const removeUserFromTeamAction = actionClient
  .inputSchema(removeUserFromTeamSchema)
  .action(async ({ parsedInput: input }) => {
    const result = await removeUserFromTeam(input);
    revalidateAdminTeamAndUser(input);

    return result;
  });
