"use server";

import {
  deleteSessionTokenCookie,
  getSessionFromCookie,
  invalidateSession
} from "@/utils/auth";
import { RATE_LIMITS, withRateLimit } from "@/utils/with-rate-limit";

export const signOutAction = async () => {
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
    },
    RATE_LIMITS.SIGN_OUT
  );
};
