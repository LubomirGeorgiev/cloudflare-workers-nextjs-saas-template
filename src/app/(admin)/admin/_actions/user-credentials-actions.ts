"use server";

import { revalidatePath } from "next/cache";

import { ADMIN_USERS_PATH } from "@/constants";
import {
  getUserCredentials,
  removeUserFromTeam,
  revokeUserApiKey,
  revokeUserConnectedApp,
} from "@/lib/admin/user-credentials";
import { actionClient } from "@/lib/safe-action";
import {
  getUserDataSchema,
  removeUserFromTeamSchema,
  revokeUserApiKeySchema,
  revokeUserConnectedAppSchema,
} from "@/schemas/admin-users.schema";

// Every write here is rendered on exactly one page. The user's own surfaces read from D1/KV
// directly on the next request, so only the admin detail page needs invalidating.
function revalidateUserDetail(userId: string): void {
  revalidatePath(`${ADMIN_USERS_PATH}/${userId}`);
}

export const getUserCredentialsAction = actionClient
  .inputSchema(getUserDataSchema)
  .action(async ({ parsedInput: input }) => {
    return getUserCredentials({ userId: input.userId });
  });

export const revokeUserConnectedAppAction = actionClient
  .inputSchema(revokeUserConnectedAppSchema)
  .action(async ({ parsedInput: input }) => {
    const result = await revokeUserConnectedApp(input);
    revalidateUserDetail(input.userId);

    return result;
  });

export const revokeUserApiKeyAction = actionClient
  .inputSchema(revokeUserApiKeySchema)
  .action(async ({ parsedInput: input }) => {
    const result = await revokeUserApiKey(input);
    revalidateUserDetail(input.userId);

    return result;
  });

export const removeUserFromTeamAction = actionClient
  .inputSchema(removeUserFromTeamSchema)
  .action(async ({ parsedInput: input }) => {
    const result = await removeUserFromTeam(input);
    revalidateUserDetail(input.userId);

    return result;
  });
