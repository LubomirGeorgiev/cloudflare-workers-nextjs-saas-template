import "server-only";

import { Hono } from "hono";

import { ADMIN_API_TAGS } from "@/api/admin/openapi-document";
import { adminOperation } from "@/api/admin/operation";
import { apiValidator } from "@/api/middleware/problem-json";
import { jsonResponse } from "@/api/openapi";
import type { ApiEnv } from "@/api/types";
import { cancelTeamSubscriptionAsAdmin } from "@/lib/admin/team-billing-admin";
import { requirePrincipal } from "@/lib/api/principal";
import {
  adminCancelTeamSubscriptionResultSchema,
  adminCancelTeamSubscriptionSchema,
  adminTeamIdParamSchema,
} from "@/schemas/api/admin.schema";

export const adminTeamRoutes = new Hono<ApiEnv>()
  .delete(
    "/teams/:teamId/subscription",
    ...adminOperation({
      operationId: "adminCancelTeamSubscription",
      tags: [ADMIN_API_TAGS.teams],
      summary: "Cancel a team's subscription",
      description:
        "Cancels the team's Stripe subscription immediately, as staff rather than as a member. " +
        "Every member drops to the free plan at once, even though the current period is paid " +
        "for, and no member is removed from the team. This never refunds anything: a refund is " +
        "issued by hand in Stripe. It bills any usage and pending prorations already owed, and " +
        "credits nothing for unused time. Stripe also stops collecting the customer's open " +
        "invoices automatically — that debt is not written off, but nothing chases it any more. " +
        "The Stripe customer, its invoice history, and its saved cards all stay, so the team can " +
        "subscribe again later. `reason` is recorded on Stripe as the cancellation comment. A " +
        "team with no subscription answers `cancelled: false` rather than failing.",
      scope: "admin:write",
      responses: {
        200: jsonResponse({
          description: "Whether there was a subscription to cancel.",
          schema: adminCancelTeamSubscriptionResultSchema,
        }),
      },
    }),
    apiValidator("param", adminTeamIdParamSchema),
    apiValidator("json", adminCancelTeamSubscriptionSchema),
    async (c) => {
      const { teamId } = c.req.valid("param");
      const { reason } = c.req.valid("json");

      return c.json(await cancelTeamSubscriptionAsAdmin({
        teamId,
        reason: `Cancelled by staff ${requirePrincipal().userId}: ${reason}`,
      }));
    },
  );
