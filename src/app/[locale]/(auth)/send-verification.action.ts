"use server";

import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { getCurrentSession } from "@/utils/auth";
import { sendUserVerificationEmail } from "@/utils/email-verification";
import { assertNotBanned } from "@/lib/account/ban";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import { v } from "@/lib/validation";

export const sendVerificationAction = actionClient
  .inputSchema(v.void())
  .action(async () => {
    return withRateLimit(
      async () => {
        const session = await getCurrentSession();

        if (!session) {
          throw new ActionError("NOT_AUTHORIZED", { key: "Client.Errors.notAuthenticated" });
        }

        // The session snapshot already carries the stamp, so this is free. `sendUserVerificationEmail`
        // itself stays unguarded: its other callers run right after creating an account.
        assertNotBanned(session.user);

        if (session?.user?.emailVerified) {
          throw new ActionError("PRECONDITION_FAILED", { key: "Client.Auth.Common.errorEmailAlreadyVerified" });
        }

        await sendUserVerificationEmail({
          userId: session.user.id,
          email: session.user.email!,
          username: session.user.firstName || session.user.email!,
        });

        return { success: true };
      },
      RATE_LIMITS.EMAIL
    );
  });
