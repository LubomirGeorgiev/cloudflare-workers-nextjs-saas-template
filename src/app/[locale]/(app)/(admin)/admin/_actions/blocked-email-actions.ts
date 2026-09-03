"use server"

import {
  countUsersMatchingPattern,
  createBlockedEmail,
  deleteBlockedEmail,
} from "@/lib/admin/blocked-emails"
import { actionClient } from "@/lib/safe-action"
import {
  countMatchingUsersSchema,
  createBlockedEmailSchema,
  deleteBlockedEmailSchema,
} from "@/schemas/admin-blocked-emails.schema"
import { requireAdmin } from "@/utils/auth"

export const createBlockedEmailAction = actionClient
  .inputSchema(createBlockedEmailSchema)
  .action(async ({ parsedInput: input }) => {
    const session = await requireAdmin()

    return await createBlockedEmail({ ...input, createdByUserId: session.userId })
  })

export const deleteBlockedEmailAction = actionClient
  .inputSchema(deleteBlockedEmailSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin()

    return await deleteBlockedEmail(input)
  })

// Read-only preview for the add dialog. Adding an entry never bans an existing account, so the
// count is the whole of what staff get: they ban the matches one at a time from the users list.
export const countMatchingUsersAction = actionClient
  .inputSchema(countMatchingUsersSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin()

    return { count: await countUsersMatchingPattern(input) }
  })
