import "server-only";

import { eq } from "drizzle-orm";
import ms from "ms";

import { getDB } from "@/db";
import { userTable } from "@/db/schema";
import { createBackgroundTouch } from "@/utils/throttled-background-touch";

export const USER_ACTIVITY_UPDATE_INTERVAL_MS = ms("5m");

const userActivityTouch = createBackgroundTouch({
  intervalMs: USER_ACTIVITY_UPDATE_INTERVAL_MS,
  write: ({ id, now }) =>
    getDB().update(userTable).set({ lastActiveAt: now }).where(eq(userTable.id, id)),
});

export function touchUserLastActiveAt(userId: string): void {
  userActivityTouch.touch(userId);
}

export function resetUserActivityThrottleForTests(): void {
  userActivityTouch.resetForTests();
}
