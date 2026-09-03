"use server"

import { ActionError } from "@/lib/action-error"
import { createBlockedEmail } from "@/lib/admin/blocked-emails"
import { banUser, unbanUser } from "@/lib/admin/user-ban"
import { actionClient } from "@/lib/safe-action"
import { banUserSchema, unbanUserSchema } from "@/schemas/admin-users.schema"
import { requireAdmin } from "@/utils/auth"
import { isValidEmailPattern } from "@/utils/email-pattern"
import { revalidateAdminUser } from "./admin-revalidate"

// The services live in `src/lib/admin/user-ban.ts` so these actions and the internal REST/MCP
// surface ban through one code path. Authorization stays here, at the door.

/**
 * The ban form's convenience checkbox. It creates an ordinary blocklist entry — the two features
 * stay separate, and a blocklist entry never bans anybody.
 *
 * Post-commit, with its own `.catch`: the ban is already durable, and a duplicate pattern (the
 * address was blocked before) must not make the ban itself report as failed.
 */
async function blockBannedEmail({
  email,
  internalReason,
  actorUserId,
}: {
  email: string | null
  internalReason: string
  actorUserId: string
}): Promise<void> {
  // An account with no address, or one the pattern parser does not accept, has nothing to block.
  if (!email || !isValidEmailPattern(email)) {
    return
  }

  await createBlockedEmail({
    pattern: email,
    reason: internalReason,
    createdByUserId: actorUserId,
  }).catch((error: unknown) => {
    console.error("Ban follow-up failed: blocklist entry", error)
  })
}

export const banUserAction = actionClient
  .inputSchema(banUserSchema)
  .action(async ({ parsedInput: { alsoBlockEmail, ...input } }) => {
    const session = await requireAdmin()

    // The service refuses this too; refusing here as well keeps the panel's message specific.
    if (session.userId === input.userId) {
      throw new ActionError("PRECONDITION_FAILED", "You cannot ban your own account.")
    }

    const result = await banUser({ ...input, actorUserId: session.userId })

    if (alsoBlockEmail && !result.alreadyBanned) {
      await blockBannedEmail({
        email: result.email,
        internalReason: input.internalReason,
        actorUserId: session.userId,
      })
    }

    revalidateAdminUser(input.userId)

    return result
  })

export const unbanUserAction = actionClient
  .inputSchema(unbanUserSchema)
  .action(async ({ parsedInput: input }) => {
    const session = await requireAdmin()

    const result = await unbanUser({ ...input, actorUserId: session.userId })
    revalidateAdminUser(input.userId)

    return result
  })
