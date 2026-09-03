import "server-only";

import { Hono } from "hono";

import { ADMIN_API_TAGS } from "@/api/admin/openapi-document";
import { adminOperation } from "@/api/admin/operation";
import { apiValidator } from "@/api/middleware/problem-json";
import { jsonResponse, preconditionFailedResponse } from "@/api/openapi";
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
  banUser,
  listUserBanEvents,
  unbanUser,
  type BanUserResult,
  type UnbanUserResult,
  type UserBanEvent,
} from "@/lib/admin/user-ban";
import { requirePrincipal } from "@/lib/api/principal";
import {
  adminBanEventListSchema,
  adminBanResultSchema,
  adminBanUserBodySchema,
  adminListUsersQuerySchema,
  adminSetUserRoleSchema,
  adminUnbanResultSchema,
  adminUnbanUserBodySchema,
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
    bannedAt: user.bannedAt ? user.bannedAt.toISOString() : null,
  };
}

function toBanResultResponse(result: BanUserResult): v.InferOutput<typeof adminBanResultSchema> {
  return {
    userId: result.userId,
    bannedAt: result.bannedAt.toISOString(),
    alreadyBanned: result.alreadyBanned,
    revokedApiKeyCount: result.revokedApiKeyCount,
    revokedGrantCount: result.revokedGrantCount,
    revokedInvitationCount: result.revokedInvitationCount,
    cancelledSubscriptionCount: result.cancelledSubscriptionCount,
    subscriptionCancellationFailedCount: result.subscriptionCancellationFailedCount,
    noticeOutcome: result.noticeOutcome,
  };
}

function toUnbanResultResponse(
  result: UnbanUserResult,
): v.InferOutput<typeof adminUnbanResultSchema> {
  return {
    userId: result.userId,
    wasNotBanned: result.wasNotBanned,
    cancelledSubscriptionCount: result.cancelledSubscriptionCount,
    noticeOutcome: result.noticeOutcome,
  };
}

function toBanEventListResponse(
  events: UserBanEvent[],
): v.InferOutput<typeof adminBanEventListSchema> {
  return {
    events: events.map((event) => ({
      id: event.id,
      action: event.action,
      internalReason: event.internalReason,
      externalReason: event.externalReason,
      actorUserId: event.actorUserId,
      actorName: event.actorName,
      noticeQueuedAt: event.noticeQueuedAt ? event.noticeQueuedAt.toISOString() : null,
      cancelledSubscriptionCount: event.cancelledSubscriptionCount,
      createdAt: event.createdAt.toISOString(),
    })),
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
        ...preconditionFailedResponse("The account is banned; unban it before promoting it."),
      },
    }),
    apiValidator("param", adminUserIdParamSchema),
    apiValidator("json", adminSetUserRoleSchema),
    async (c) => {
      const { userId } = c.req.valid("param");
      const { role } = c.req.valid("json");

      return c.json(toUserResponse(await setUserRole({ userId, role })));
    },
  )
  .put(
    "/users/:userId/ban",
    ...adminOperation({
      operationId: "adminBanUser",
      tags: [ADMIN_API_TAGS.users],
      summary: "Ban a user",
      description:
        "Suspends one account. The account row stays; the person loses every way to authenticate. " +
        "It revokes all three credential kinds — cookie sessions, API keys, and OAuth grants — " +
        "revokes the pending invitations they sent, and cancels the Stripe subscription of every " +
        "team they own, immediately and with no refund. It deletes nothing, removes no team " +
        "member, and transfers no ownership. Banning an account whose role is `admin` is refused: " +
        "change the role to `user` first. Re-banning an already banned account writes no second " +
        "event and sends no second notice, but repeats every revocation, so it repairs a cleanup " +
        "step that failed the first time. " +
        "`internalReason` is required and is staff-only: it is never sent to the account holder " +
        "by any path. `externalReason` is optional and is the ONLY text the account holder ever " +
        "sees — put triage notes in `internalReason`, or they are published to the person you are " +
        "banning. `sendEmail` defaults to true, so a suspension notice is emailed unless you pass " +
        "false; the notice says the account was suspended even when `externalReason` is absent.",
      scope: "admin:write",
      responses: {
        200: jsonResponse({
          description: "What the ban revoked and cancelled, and whether a notice was queued.",
          schema: adminBanResultSchema,
        }),
        ...preconditionFailedResponse("The account is an admin, or it is the caller's own account."),
      },
    }),
    apiValidator("param", adminUserIdParamSchema),
    apiValidator("json", adminBanUserBodySchema),
    async (c) => {
      const { userId } = c.req.valid("param");

      return c.json(toBanResultResponse(await banUser({
        userId,
        ...c.req.valid("json"),
        actorUserId: requirePrincipal().userId,
      })));
    },
  )
  .post(
    // POST rather than `DELETE /users/:userId/ban`: the tidier verb now needs a body, and a body
    // on DELETE is widely stripped by proxies and poorly supported by clients. Consistency with
    // the ban body wins over verb purity.
    "/users/:userId/unban",
    ...adminOperation({
      operationId: "adminUnbanUser",
      tags: [ADMIN_API_TAGS.users],
      summary: "Lift a user's ban",
      description:
        "Restores sign-in for a suspended account, and restores nothing else. The API keys and " +
        "OAuth grants the ban revoked stay revoked and must be created again; the invitations it " +
        "revoked must be re-sent; any cancelled subscription is gone and the team must subscribe " +
        "again, with no credit for the unused part of the period the ban cut short. Unbanning an " +
        "account that is not banned is a no-op. `internalReason` is required and staff-only; " +
        "`externalReason` is optional and is the only text the account holder ever sees. " +
        "`sendEmail` defaults to true.",
      scope: "admin:write",
      responses: {
        200: jsonResponse({
          description: "Whether the ban was lifted, and whether a notice was queued.",
          schema: adminUnbanResultSchema,
        }),
      },
    }),
    apiValidator("param", adminUserIdParamSchema),
    apiValidator("json", adminUnbanUserBodySchema),
    async (c) => {
      const { userId } = c.req.valid("param");

      return c.json(toUnbanResultResponse(await unbanUser({
        userId,
        ...c.req.valid("json"),
        actorUserId: requirePrincipal().userId,
      })));
    },
  )
  .get(
    "/users/:userId/ban-events",
    ...adminOperation({
      operationId: "adminListUserBanEvents",
      tags: [ADMIN_API_TAGS.users],
      summary: "List a user's ban history",
      description:
        "Returns this account's ban and unban events, newest first and bounded. The log is " +
        "append-only: nothing is ever cleared, so a ban that was later lifted still shows its " +
        "reason and its author, and a repeat offender shows every round. Answers \"has this " +
        "account been banned before, and what for\" without a human opening the admin panel. " +
        "`internalReason` on each event is staff-only and was never sent to the account holder; " +
        "`externalReason` is what they were sent, when `noticeQueuedAt` is set.",
      scope: "admin:read",
      responses: {
        200: jsonResponse({
          description: "The account's ban history, newest first.",
          schema: adminBanEventListSchema,
        }),
      },
    }),
    apiValidator("param", adminUserIdParamSchema),
    async (c) => {
      const { userId } = c.req.valid("param");

      return c.json(toBanEventListResponse(await listUserBanEvents({ userId })));
    },
  );
