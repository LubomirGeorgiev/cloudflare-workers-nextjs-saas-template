"use server";

import { revalidatePath } from "next/cache";

import { ADMIN_API_DOCS_PATH } from "@/constants";
import { createAdminApiKey, revokeAdminApiKey } from "@/lib/admin/admin-api-keys";
import { revokeAdminOAuthGrant } from "@/lib/admin/admin-oauth-grants";
import { actionClient } from "@/lib/safe-action";
import { createAdminApiKeySchema, revokeAdminApiKeySchema } from "@/schemas/admin-api-key.schema";
import { revokeOAuthGrantSchema } from "@/schemas/oauth.schema";

// Both services call `requireAdmin` themselves, so the admin check is not repeated here — it lives
// with the rule it protects rather than at each caller.

export const createAdminApiKeyAction = actionClient
  .inputSchema(createAdminApiKeySchema)
  .action(async ({ parsedInput: input }) => {
    const created = await createAdminApiKey(input);

    revalidatePath(ADMIN_API_DOCS_PATH);

    // The secret is returned exactly once, here; it is never recoverable afterwards.
    return { secret: created.secret, key: created.key };
  });

export const revokeAdminApiKeyAction = actionClient
  .inputSchema(revokeAdminApiKeySchema)
  .action(async ({ parsedInput: input }) => {
    await revokeAdminApiKey({ keyId: input.keyId });

    revalidatePath(ADMIN_API_DOCS_PATH);

    return { keyId: input.keyId };
  });


export const revokeAdminOAuthGrantAction = actionClient
  .inputSchema(revokeOAuthGrantSchema)
  .action(async ({ parsedInput: input }) => {
    await revokeAdminOAuthGrant({ grantId: input.grantId });

    revalidatePath(ADMIN_API_DOCS_PATH);

    return { grantId: input.grantId };
  });
