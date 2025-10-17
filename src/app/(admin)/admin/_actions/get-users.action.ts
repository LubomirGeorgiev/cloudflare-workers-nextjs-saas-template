"use server"

import { createServerAction } from "zsa"
import { getDB } from "@/db"
import { requireAdmin } from "@/utils/auth"
import { z } from "zod"
import { sql } from "drizzle-orm"
import { userTable } from "@/db/schema"
import { PAGE_SIZE_OPTIONS } from "../admin-constants"

const getUsersSchema = z.object({
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(Math.max(...PAGE_SIZE_OPTIONS)).default(PAGE_SIZE_OPTIONS[0]),
  emailFilter: z.string().optional(),
})

export const getUsersAction = createServerAction()
  .input(getUsersSchema)
  .handler(async ({ input }) => {
    await requireAdmin()

    const db = getDB()
    const { page, pageSize, emailFilter } = input

    // Calculate offset
    const offset = (page - 1) * pageSize

    // Build where clause
    const whereClause = emailFilter
      ? sql`${userTable.email} LIKE ${`%${emailFilter}%`}`
      : undefined

    // Fetch total count
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(userTable)
      .where(whereClause)

    // Fetch paginated users
    const users = await db.query.userTable.findMany({
      columns: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        emailVerified: true,
        createdAt: true,
      },
      where: whereClause,
      orderBy: (users, { desc }) => [desc(users.createdAt)],
      limit: pageSize,
      offset,
    })

    // Transform the data to match our table's expected format
    const transformedUsers = users.map(user => ({
      id: user.id,
      email: user.email,
      name: user.firstName && user.lastName
        ? `${user.firstName} ${user.lastName}`
        : null,
      role: user.role,
      status: user.emailVerified ? "active" as const : "inactive" as const,
      createdAt: user.createdAt,
    }))

    return {
      users: transformedUsers,
      totalCount: count,
      page,
      pageSize,
      totalPages: Math.ceil(count / pageSize),
    }
  })
