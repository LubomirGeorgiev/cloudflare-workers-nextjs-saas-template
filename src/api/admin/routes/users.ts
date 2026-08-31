import "server-only";

import { Hono } from "hono";

import { ADMIN_API_TAGS } from "@/api/admin/openapi-document";
import { adminOperation } from "@/api/admin/operation";
import { apiValidator } from "@/api/middleware/problem-json";
import { jsonResponse } from "@/api/openapi";
import type { ApiEnv } from "@/api/types";
import { v } from "@/lib/validation";
import {
  getAdminUserSummary,
  listAdminUsers,
  setUserRole,
  type AdminUserPage,
  type AdminUserSummary,
} from "@/lib/admin/users";
import {
  adminListUsersQuerySchema,
  adminSetUserRoleSchema,
  adminUserIdParamSchema,
  adminUserListSchema,
  adminUserSchema,
} from "@/schemas/api/admin.schema";

// Dates cross the wire as ISO strings, so the service's `Date` fields are mapped once here rather
// than in each handler.
function toUserResponse(user: AdminUserSummary): v.InferOutput<typeof adminUserSchema> {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    lastActiveAt: user.lastActiveAt ? user.lastActiveAt.toISOString() : null,
  };
}

function toUserListResponse(page: AdminUserPage): v.InferOutput<typeof adminUserListSchema> {
  return {
    users: page.users.map(toUserResponse),
    totalCount: page.totalCount,
    page: page.page,
    pageSize: page.pageSize,
    totalPages: page.totalPages,
  };
}

export const adminUserRoutes = new Hono<ApiEnv>()
  .get(
    "/users",
    ...adminOperation({
      operationId: "adminListUsers",
      tags: [ADMIN_API_TAGS.users],
      summary: "List every user on the deployment",
      description:
        "Lists user accounts across the whole deployment, newest first, with their role and " +
        "whether their email is verified. Optionally filters by an email substring. This is " +
        "internal staff tooling: it is not limited to the caller's own teams.",
      scope: "admin:read",
      responses: {
        200: jsonResponse({ description: "A page of users.", schema: adminUserListSchema }),
      },
    }),
    apiValidator("query", adminListUsersQuerySchema),
    async (c) => {
      return c.json(toUserListResponse(await listAdminUsers(c.req.valid("query"))));
    },
  )
  .get(
    "/users/:userId",
    ...adminOperation({
      operationId: "adminGetUser",
      tags: [ADMIN_API_TAGS.users],
      summary: "Get one user",
      description:
        "Returns one user account by id. Deliberately the same projection the listing returns: " +
        "credentials, passkeys, and sessions are not exposed over this API.",
      scope: "admin:read",
      responses: {
        200: jsonResponse({ description: "The user.", schema: adminUserSchema }),
      },
    }),
    apiValidator("param", adminUserIdParamSchema),
    async (c) => {
      const { userId } = c.req.valid("param");

      return c.json(toUserResponse(await getAdminUserSummary({ userId })));
    },
  )
  .put(
    "/users/:userId/role",
    ...adminOperation({
      operationId: "adminSetUserRole",
      tags: [ADMIN_API_TAGS.users],
      summary: "Change a user's role",
      description:
        "Promotes a user to `admin` or demotes them to `user`. Demoting revokes every internal API " +
        "key that user holds, because each admin request re-reads the role and those keys are not " +
        "visible outside the admin panel they would no longer be able to open. Every session and " +
        "cached bearer credential is refreshed immediately. A caller can demote themselves; the " +
        "next request with this credential will be refused, and this credential is revoked too if " +
        "it is an internal key.",
      scope: "admin:write",
      responses: {
        200: jsonResponse({ description: "The updated user.", schema: adminUserSchema }),
      },
    }),
    apiValidator("param", adminUserIdParamSchema),
    apiValidator("json", adminSetUserRoleSchema),
    async (c) => {
      const { userId } = c.req.valid("param");
      const { role } = c.req.valid("json");

      return c.json(toUserResponse(await setUserRole({ userId, role })));
    },
  );
