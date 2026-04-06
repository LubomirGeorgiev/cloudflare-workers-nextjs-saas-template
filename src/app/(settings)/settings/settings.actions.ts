"use server";

import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { getDB } from "@/db";
import { userTable } from "@/db/schema";
import { requireVerifiedEmail } from "@/utils/auth";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { userSettingsSchema } from "@/schemas/settings.schema";
import { updateAllSessionsOfUser } from "@/utils/kv-session";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";

export const updateUserProfileAction = actionClient
  .inputSchema(userSettingsSchema)
  .action(async ({ parsedInput: input }) => {
    return withRateLimit(
      async () => {
        const session = await requireVerifiedEmail();
        const db = getDB();

        if (!session?.user?.id) {
          throw new ActionError("NOT_AUTHORIZED", "Unauthorized");
        }

        try {
          await db.update(userTable)
            .set({
              ...input,
            })
            .where(eq(userTable.id, session.user.id));

          await updateAllSessionsOfUser(session.user.id)

          revalidatePath("/settings");
          return { success: true };
        } catch (error) {
          console.error(error)
          throw new ActionError(
            "INTERNAL_SERVER_ERROR",
            "Failed to update profile"
          );
        }
      },
      RATE_LIMITS.SETTINGS
    );
  });
