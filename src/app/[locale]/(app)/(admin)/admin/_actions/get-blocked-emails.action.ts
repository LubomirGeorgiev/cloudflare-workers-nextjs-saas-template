"use server"

import { listBlockedEmails } from "@/lib/admin/blocked-emails"
import { actionClient } from "@/lib/safe-action"
import { getBlockedEmailsSchema } from "@/schemas/admin-blocked-emails.schema"
import { requireAdmin } from "@/utils/auth"

// The query itself lives in `src/lib/admin/blocked-emails.ts` so this action and the internal
// REST/MCP surface list the blocklist through one code path.
export const getBlockedEmailsAction = actionClient
  .inputSchema(getBlockedEmailsSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin()

    return listBlockedEmails(input)
  })
