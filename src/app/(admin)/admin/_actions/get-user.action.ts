"use server"

import { ActionError } from "@/lib/action-error"
import { actionClient } from "@/lib/safe-action"
import { getDB } from "@/db"
import { requireAdmin } from "@/utils/auth"
import { requiredString, v } from "@/lib/validation"

const getUserDataSchema = v.object({
  userId: requiredString("User ID is required"),
})

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

    const transactions = await db.query.creditTransactionTable.findMany({
      where: { userId: input.userId },
      orderBy: { createdAt: "desc" },
      limit: 10,
    })

    const passkeys = await db.query.passKeyCredentialTable.findMany({
      where: { userId: input.userId },
      orderBy: { createdAt: "desc" },
    })

    return {
      user,
      transactions,
      passkeys,
    }
  })
