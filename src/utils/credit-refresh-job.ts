import "server-only";

import { refreshUserMonthlyCreditsIfDue } from "@/utils/credits";

export async function refreshScheduledUserCreditsIfDue({
  userId,
}: {
  userId: string;
}): Promise<void> {
  await refreshUserMonthlyCreditsIfDue({ userId });
}
