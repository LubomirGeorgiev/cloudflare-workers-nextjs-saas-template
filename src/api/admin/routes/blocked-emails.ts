import "server-only";

import { Hono } from "hono";

import { ADMIN_API_TAGS } from "@/api/admin/openapi-document";
import { adminOperation } from "@/api/admin/operation";
import { apiValidator } from "@/api/middleware/problem-json";
import { jsonResponse } from "@/api/openapi";
import type { ApiEnv } from "@/api/types";
import {
  createBlockedEmail,
  deleteBlockedEmail,
  listBlockedEmails,
  type AdminBlockedEmail,
  type AdminBlockedEmailPage,
} from "@/lib/admin/blocked-emails";
import { requirePrincipal } from "@/lib/api/principal";
import { v } from "@/lib/validation";
import {
  adminBlockedEmailIdParamSchema,
  adminBlockedEmailListSchema,
  adminBlockedEmailSchema,
  adminCreateBlockedEmailSchema,
  adminListBlockedEmailsQuerySchema,
} from "@/schemas/api/admin.schema";
import { successSchema } from "@/schemas/api/common.schema";

function toBlockedEmailResponse(
  entry: AdminBlockedEmail,
): v.InferOutput<typeof adminBlockedEmailSchema> {
  return {
    id: entry.id,
    kind: entry.kind,
    value: entry.value,
    pattern: entry.pattern,
    reason: entry.reason,
    createdByUserId: entry.createdByUserId,
    createdAt: entry.createdAt.toISOString(),
  };
}

function toBlockedEmailListResponse(
  page: AdminBlockedEmailPage,
): v.InferOutput<typeof adminBlockedEmailListSchema> {
  return {
    entries: page.entries.map(toBlockedEmailResponse),
    totalCount: page.totalCount,
    page: page.page,
    pageSize: page.pageSize,
    totalPages: page.totalPages,
  };
}

// The blocklist governs account CREATION only. An account that already exists is stopped by a ban
// (`adminBanUser`), never by an entry here — every tool description below repeats that, because it
// is the single rule an agent has to get right to use both features correctly.
export const adminBlockedEmailRoutes = new Hono<ApiEnv>()
  .get(
    "/blocked-emails",
    ...adminOperation({
      operationId: "adminListBlockedEmails",
      tags: [ADMIN_API_TAGS.blockedEmails],
      summary: "List the registration blocklist",
      description:
        "Lists the email patterns that may not create an account, newest first. Each entry is one " +
        "of three shapes: an exact address, a whole domain, or a domain and every subdomain under " +
        "it. Entries here never suspend an account that already exists.",
      scope: "admin:read",
      responses: {
        200: jsonResponse({
          description: "A page of blocklist entries.",
          schema: adminBlockedEmailListSchema,
        }),
      },
    }),
    apiValidator("query", adminListBlockedEmailsQuerySchema),
    async (c) => {
      return c.json(toBlockedEmailListResponse(await listBlockedEmails(c.req.valid("query"))));
    },
  )
  .post(
    "/blocked-emails",
    ...adminOperation({
      operationId: "adminCreateBlockedEmail",
      tags: [ADMIN_API_TAGS.blockedEmails],
      summary: "Block an email pattern from registering",
      description:
        "Adds one pattern to the registration blocklist. `pattern` takes exactly three shapes: " +
        "`spam@example.com` blocks that one address, `*@example.com` blocks every address at that " +
        "domain, and `*@*.example.com` blocks that domain AND every subdomain of it. Anything " +
        "else is refused, including a bare domain and a partial wildcard such as " +
        "`ad*@example.com`. Adding an entry blocks new sign-ups, new passkey registrations, new " +
        "Google sign-ups, and team invitations to a matching address. It does NOT suspend the " +
        "accounts that already match — ban those one at a time with adminBanUser. The same " +
        "pattern cannot be added twice.",
      scope: "admin:write",
      responses: {
        200: jsonResponse({
          description: "The blocklist entry that was created.",
          schema: adminBlockedEmailSchema,
        }),
      },
    }),
    apiValidator("json", adminCreateBlockedEmailSchema),
    async (c) => {
      const entry = await createBlockedEmail({
        ...c.req.valid("json"),
        createdByUserId: requirePrincipal().userId,
      });

      return c.json(toBlockedEmailResponse(entry));
    },
  )
  .delete(
    "/blocked-emails/:id",
    ...adminOperation({
      operationId: "adminDeleteBlockedEmail",
      tags: [ADMIN_API_TAGS.blockedEmails],
      summary: "Remove a blocklist entry",
      description:
        "Deletes one entry, so addresses it matched can register again. Accounts are unaffected " +
        "either way: the entry never banned anybody.",
      scope: "admin:write",
      responses: {
        200: jsonResponse({ description: "The entry was removed.", schema: successSchema }),
      },
    }),
    apiValidator("param", adminBlockedEmailIdParamSchema),
    async (c) => {
      return c.json(await deleteBlockedEmail(c.req.valid("param")));
    },
  );
