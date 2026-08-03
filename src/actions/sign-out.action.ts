"use server";

import { actionClient } from "@/lib/safe-action";
import {
  deleteSessionTokenCookie,
  getCurrentSession,
  invalidateSession
} from "@/utils/auth";
import { RATE_LIMITS, withRateLimit } from "@/utils/with-rate-limit";

export const signOutAction = actionClient.action(async () => {
  return withRateLimit(
    async () => {
      const session = await getCurrentSession()

      // Signing out is a cookie operation: a bearer credential has no KV session to invalidate,
      // and clearing the cookie below is still the whole of what sign-out means for it.
      if (session?.kind === "cookie") {
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
