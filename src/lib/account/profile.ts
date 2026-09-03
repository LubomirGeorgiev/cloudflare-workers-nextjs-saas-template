import "server-only";

import { eq } from "drizzle-orm";

import { getDB } from "@/db";
import { userTable } from "@/db/schema";
import { ActionError } from "@/lib/action-error";
import type { UserSettingsSchema } from "@/schemas/settings.schema";
import { requireVerifiedEmail } from "@/utils/auth";
import { updateAllSessionsOfUser } from "@/utils/kv-session";

// Mirrors getUserFromDB's projection, so the returned row is the session/DTO shape and never
// carries passwordHash or the other columns a caller must not see.
const UPDATED_USER_COLUMNS = {
  id: userTable.id,
  email: userTable.email,
  firstName: userTable.firstName,
  lastName: userTable.lastName,
  role: userTable.role,
  emailVerified: userTable.emailVerified,
  avatar: userTable.avatar,
  preferredLocale: userTable.preferredLocale,
  createdAt: userTable.createdAt,
  updatedAt: userTable.updatedAt,
  bannedAt: userTable.bannedAt,
};

async function writeUserProfile({ userId, input }: { userId: string; input: UserSettingsSchema }) {
  const db = getDB();

  try {
    const [updatedUser] = await db.update(userTable)
      .set({
        ...input,
      })
      .where(eq(userTable.id, userId))
      .returning(UPDATED_USER_COLUMNS);

    return updatedUser;
  } catch (error) {
    console.error(error)
    throw new ActionError("INTERNAL_SERVER_ERROR", { key: "Client.Settings.Profile.errorUpdateFailed" });
  }
}

export async function updateUserProfile(input: UserSettingsSchema) {
  const session = await requireVerifiedEmail();

  const updatedUser = await writeUserProfile({ userId: session.user.id, input });

  // Defensive: requireVerifiedEmail resolved a session for this id, so the row is only missing if
  // the account is deleted in the race window between that check and the update.
  if (!updatedUser) {
    throw new ActionError("INTERNAL_SERVER_ERROR", { key: "Client.Settings.Profile.errorUpdateFailed" });
  }

  // D1 has no transactions, so the row above is already durable: refreshing the cached session and
  // principal snapshots is a post-commit effect and must never fail the committed write.
  await updateAllSessionsOfUser(session.user.id).catch((error: unknown) => {
    console.error("Profile update follow-up failed: session refresh", error);
  });

  return { success: true, user: updatedUser };
}
