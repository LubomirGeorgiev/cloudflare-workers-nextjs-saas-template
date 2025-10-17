"use server"

import { createServerAction } from "zsa"
import { getDB } from "@/db"
import { requireAdmin } from "@/utils/auth"
import { z } from "zod"
import { userTable, creditTransactionTable, passKeyCredentialTable } from "@/db/schema"
import { eq, desc } from "drizzle-orm"

const getUserSchema = z.object({
  userId: z.string().min(1),
})

const getUserHandler = async ({ input }: { input: { userId: string } }) => {
  await requireAdmin()

  const db = getDB()
  const { userId } = input

  // Fetch user with all details
  const user = await db.query.userTable.findFirst({
    where: eq(userTable.id, userId),
  })

  if (!user) {
    throw new Error("User not found")
  }

  // Fetch user's credit transactions (last 10)
  const transactions = await db.query.creditTransactionTable.findMany({
    where: eq(creditTransactionTable.userId, userId),
    orderBy: [desc(creditTransactionTable.createdAt)],
    limit: 10,
  })

  // Fetch user's passkey credentials
  const passkeys = await db.query.passKeyCredentialTable.findMany({
    where: eq(passKeyCredentialTable.userId, userId),
    orderBy: [desc(passKeyCredentialTable.createdAt)],
  })

  return {
    user,
    transactions,
    passkeys,
  }
}

export const getUserAction = createServerAction()
  .input(getUserSchema)
  .handler(getUserHandler)

// Export handler for direct use in server components
export const getUserData = getUserHandler
