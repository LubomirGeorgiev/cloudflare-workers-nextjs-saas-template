"use server";

import { revalidatePath } from "next/cache";

import { updateUserProfile } from "@/lib/account/profile";
import { actionClient } from "@/lib/safe-action";
import { userSettingsSchema } from "@/schemas/settings.schema";
import { RATE_LIMITS } from "@/utils/with-rate-limit";
import { withUserRateLimit } from "@/utils/with-user-rate-limit";

export const updateUserProfileAction = actionClient
  .inputSchema(userSettingsSchema)
  .action(async ({ parsedInput: input }) => {
    return withUserRateLimit(
      async () => {
        // The updated row is for the API response; the form only reads back the refreshed session.
        const { success } = await updateUserProfile(input);

        revalidatePath("/settings");

        return { success };
      },
      RATE_LIMITS.SETTINGS
    );
  });
