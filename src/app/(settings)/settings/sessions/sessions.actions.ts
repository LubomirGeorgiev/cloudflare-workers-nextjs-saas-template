"use server";

import { getUserSessions, revokeUserSession } from "@/lib/account/sessions";
import { actionClient } from "@/lib/safe-action";
import { v } from "@/lib/validation";
import { deleteSessionSchema } from "@/schemas/session.schema";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import { withUserRateLimit } from "@/utils/with-user-rate-limit";

export const getSessionsAction = actionClient
  .inputSchema(v.void())
  .action(async () => {
    return withUserRateLimit(getUserSessions, RATE_LIMITS.SETTINGS);
  });

export const deleteSessionAction = actionClient
  .inputSchema(deleteSessionSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(
      () => revokeUserSession({ sessionId: input.sessionId }),
      RATE_LIMITS.DELETE_SESSION
    );
  });
