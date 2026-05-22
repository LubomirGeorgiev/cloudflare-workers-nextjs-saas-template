"use server";

import { actionClient } from "@/lib/safe-action";
import {
  deleteSessionTokenCookie,
  getSessionFromCookie,
  invalidateSession
} from "@/utils/auth";
import { RATE_LIMITS, withRateLimit } from "@/utils/with-rate-limit";

export const signOutAction = actionClient.action(async () => {
  return withRateLimit(
    async () => {
      const session = await getSessionFromCookie()

      if (session) {
        await invalidateSession(
          session.id,
          session.userId
        );
      }

      await deleteSessionTokenCookie();
      return { success: true };
    },
    RATE_LIMITS.SIGN_OUT
  );
});
