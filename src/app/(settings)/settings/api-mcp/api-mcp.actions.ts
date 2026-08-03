"use server";

import { revalidatePath } from "next/cache";

import { SETTINGS_API_MCP_PATH } from "@/constants";
import { listUserApiKeys } from "@/lib/api-keys/api-keys";
import { listConnectedApps, revokeConnectedApp } from "@/lib/oauth/connected-apps";
import { actionClient } from "@/lib/safe-action";
import { v } from "@/lib/validation";
import { revokeOAuthGrantSchema } from "@/schemas/oauth.schema";
import { RATE_LIMITS } from "@/utils/with-rate-limit";
import { withUserRateLimit } from "@/utils/with-user-rate-limit";

// Key create/revoke live in `@/actions/api-key-actions` because the team settings section drives
// the same flows with a `teamId`; everything here is personal-account-specific.
export const getApiKeysAction = actionClient
  .inputSchema(v.void())
  .action(async () => {
    return withUserRateLimit(listUserApiKeys, RATE_LIMITS.SETTINGS);
  });

export const getConnectedAppsAction = actionClient
  .inputSchema(v.void())
  .action(async () => {
    return withUserRateLimit(listConnectedApps, RATE_LIMITS.SETTINGS);
  });

export const revokeConnectedAppAction = actionClient
  .inputSchema(revokeOAuthGrantSchema)
  .action(async ({ parsedInput: input }) => {
    return withUserRateLimit(async () => {
      await revokeConnectedApp({ grantId: input.grantId });

      revalidatePath(SETTINGS_API_MCP_PATH);

      return { grantId: input.grantId };
    }, RATE_LIMITS.SETTINGS);
  });
