"use server"

import { listAdminTeams } from "@/lib/admin/teams"
import { actionClient } from "@/lib/safe-action"
import { getTeamsSchema } from "@/schemas/admin-teams.schema"
import { requireAdmin } from "@/utils/auth"

// The query itself lives in `src/lib/admin/teams.ts`, mirroring `get-users.action.ts`, so this
// action and any internal REST/MCP surface list teams through one code path.
export const getTeamsAction = actionClient
  .inputSchema(getTeamsSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin()

    return listAdminTeams(input)
  })
