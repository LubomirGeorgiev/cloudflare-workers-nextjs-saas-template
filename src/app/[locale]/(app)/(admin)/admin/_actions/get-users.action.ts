"use server"

import { listAdminUsers } from "@/lib/admin/users"
import { actionClient } from "@/lib/safe-action"
import { getUsersSchema } from "@/schemas/admin-users.schema"
import { requireAdmin } from "@/utils/auth"

// The query itself lives in `src/lib/admin/users.ts` so this action and the internal REST/MCP
// surface list users through one code path.
export const getUsersAction = actionClient
  .inputSchema(getUsersSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin()

    return listAdminUsers(input)
  })
