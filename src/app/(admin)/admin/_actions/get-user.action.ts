"use server"

import { ActionError } from "@/lib/action-error"
import { actionClient } from "@/lib/safe-action"
import { getDB } from "@/db"
import { requireAdmin } from "@/utils/auth"
import { getUserDataSchema } from "@/schemas/admin-users.schema"

export const getUserData = actionClient
  .inputSchema(getUserDataSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin()

    const db = getDB()

    const user = await db.query.userTable.findFirst({
      where: { id: input.userId },
    })

    if (!user) {
      throw new ActionError("NOT_FOUND", "User not found")
    }

    const passkeys = await db.query.passKeyCredentialTable.findMany({
      where: { userId: input.userId },
      orderBy: { createdAt: "desc" },
    })

    return {
      user,
      passkeys,
    }
  })
