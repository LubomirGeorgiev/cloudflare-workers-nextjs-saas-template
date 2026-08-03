"use server";

import { revalidatePath } from "next/cache";

import { SETTINGS_API_MCP_PATH, TEAMS_DASHBOARD_PATH } from "@/constants";
import {
  createApiKeyFromInput,
  getApiKeyTeamSlug,
  revokeApiKey,
  updateApiKeyScopes,
} from "@/lib/api-keys/api-keys";
import { actionClient } from "@/lib/safe-action";
import {
  createApiKeySchema,
  revokeApiKeySchema,
  updateApiKeyScopesSchema,
} from "@/schemas/api-key.schema";
import { RATE_LIMITS } from "@/utils/with-rate-limit";
import { withUserRateLimit } from "@/utils/with-user-rate-limit";

// A team key is listed on the team page, a personal one in settings, and either surface can drive
// both flows — so a write to a team key has to invalidate the team page too.
function revalidateApiKeySurfaces(teamSlug: string | null): void {
  revalidatePath(SETTINGS_API_MCP_PATH);

  if (teamSlug) {
    revalidatePath(`${TEAMS_DASHBOARD_PATH}/${teamSlug}`);
  }
}

// Shared by the personal settings page and the team settings section: the only difference is
// whether `teamId` is present, which is also what decides the permission check in the service.
export const createApiKeyAction = actionClient
  .inputSchema(createApiKeySchema)
  .action(async ({ parsedInput: input }) => {
    return withUserRateLimit(
      async () => {
        const created = await createApiKeyFromInput(input);

        revalidateApiKeySurfaces(
          input.teamId ? await getApiKeyTeamSlug({ keyId: created.key.id }) : null,
        );

        return created;
      },
      RATE_LIMITS.SETTINGS,
    );
  });

export const updateApiKeyScopesAction = actionClient
  .inputSchema(updateApiKeyScopesSchema)
  .action(async ({ parsedInput: input }) => {
    return withUserRateLimit(
      async () => {
        const updated = await updateApiKeyScopes({ keyId: input.keyId, scopes: input.scopes });

        revalidateApiKeySurfaces(await getApiKeyTeamSlug({ keyId: input.keyId }));

        return updated;
      },
      RATE_LIMITS.SETTINGS,
    );
  });

export const revokeApiKeyAction = actionClient
  .inputSchema(revokeApiKeySchema)
  .action(async ({ parsedInput: input }) => {
    return withUserRateLimit(
      async () => {
        const result = await revokeApiKey({ keyId: input.keyId });

        // The row survives revocation, so its team is still readable — and the revoke input never
        // says which surface the key belongs to.
        revalidateApiKeySurfaces(await getApiKeyTeamSlug({ keyId: input.keyId }));

        return result;
      },
      RATE_LIMITS.SETTINGS,
    );
  });
