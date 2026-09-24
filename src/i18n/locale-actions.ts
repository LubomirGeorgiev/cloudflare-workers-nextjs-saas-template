"use server";

import { eq } from "drizzle-orm";

import { getDB } from "@/db";
import { userTable } from "@/db/schema";
import { actionClient } from "@/lib/safe-action";
import { setUserLocaleSchema } from "@/schemas/locale.schema";
import { getCurrentSession } from "@/utils/auth";
import { RATE_LIMITS } from "@/utils/with-rate-limit";
import { withUserRateLimit } from "@/utils/with-user-rate-limit";

// Logged-in users get the locale saved to the DB so the preference follows them across devices.
// The client owns the non-HttpOnly cookie: mutating it here makes Vinext revalidate the old
// localized route, so `useChangeLocale` writes it only after this action returns.
export const setUserLocaleAction = actionClient
  .inputSchema(setUserLocaleSchema)
  .action(async ({ parsedInput: { locale } }) => {
    return withUserRateLimit(
      async () => {
        const session = await getCurrentSession();

        // An anonymous visitor has no row to write; the cookie is the whole preference.
        if (!session?.user) {
          return { success: true };
        }

        await getDB()
          .update(userTable)
          .set({ preferredLocale: locale })
          .where(eq(userTable.id, session.user.id));

        return { success: true };
      },
      RATE_LIMITS.SETTINGS,
    );
  });
