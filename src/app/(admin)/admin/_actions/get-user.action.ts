"use server"

import { z } from "zod"
import { ActionError } from "@/lib/action-error"
import { actionClient } from "@/lib/safe-action"
import { getDB } from "@/db"
import { requireAdmin } from "@/utils/auth"
import { userTable, creditTransactionTable, passKeyCredentialTable } from "@/db/schema"
import { eq, desc } from "drizzle-orm"

const getUserDataSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
})

export const getUserData = actionClient
  .inputSchema(getUserDataSchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin()

    const db = getDB()

    // Fetch user with all details
    const user = await db.query.userTable.findFirst({
      where: eq(userTable.id, input.userId),
    })

    if (!user) {
      throw new ActionError("NOT_FOUND", "User not found")
    }

    // Fetch user's credit transactions (last 10)
    const transactions = await db.query.creditTransactionTable.findMany({
      where: eq(creditTransactionTable.userId, input.userId),
      orderBy: [desc(creditTransactionTable.createdAt)],
      limit: 10,
    })

    // Fetch user's passkey credentials
    const passkeys = await db.query.passKeyCredentialTable.findMany({
      where: eq(passKeyCredentialTable.userId, input.userId),
      orderBy: [desc(passKeyCredentialTable.createdAt)],
    })

    return {
      user,
      transactions,
      passkeys,
    }
  })
