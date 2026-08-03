"use server";

import { revalidatePath } from "next/cache";

import { ADMIN_OAUTH_APPS_PATH } from "@/constants";
import { deleteOAuthApp, listOAuthApps, setOAuthAppVerified } from "@/lib/oauth/oauth-apps";
import { getOAuthHelpers } from "@/lib/oauth/provider-api";
import { actionClient } from "@/lib/safe-action";
import {
  listOAuthAppsSchema,
  oauthAppClientIdSchema,
  setOAuthAppVerifiedSchema,
} from "@/schemas/oauth.schema";
import { requireAdmin } from "@/utils/auth";

export const getOAuthAppsAction = actionClient
  .inputSchema(listOAuthAppsSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const { apps, totalCount } = await listOAuthApps(input);

    return {
      apps: apps.map((app) => ({
        ...app,
        redirectHosts: app.redirectUris.map(toHost).filter(Boolean),
      })),
      totalCount,
      totalPages: Math.ceil(totalCount / input.pageSize),
    };
  });

function toHost(uri: string): string {
  try {
    return new URL(uri).host;
  } catch {
    return "";
  }
}

// Verification decides the consent scope tier. For DCR clients it also opts the expiring
// registration into renewal; stable CIMD and operator-issued identities need no lease renewal.
export const setOAuthAppVerifiedAction = actionClient
  .inputSchema(setOAuthAppVerifiedSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    await setOAuthAppVerified(input);
    revalidatePath(ADMIN_OAUTH_APPS_PATH);

    return { clientId: input.clientId };
  });

// `deleteClient` cascades: every grant for this client, across all users, and their tokens go
// with it. The D1 row is removed after, so a failed cascade leaves the app visible and retryable.
export const deleteOAuthAppAction = actionClient
  .inputSchema(oauthAppClientIdSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    await getOAuthHelpers().deleteClient(input.clientId);
    await deleteOAuthApp(input.clientId);
    revalidatePath(ADMIN_OAUTH_APPS_PATH);

    return { clientId: input.clientId };
  });
