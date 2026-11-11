import "server-only";

import { Hono } from "hono";

import { ADMIN_API_TAGS } from "@/api/admin/openapi-document";
import { adminOperation } from "@/api/admin/operation";
import { apiValidator } from "@/api/middleware/problem-json";
import { jsonResponse } from "@/api/openapi";
import type { ApiEnv } from "@/api/types";
import { cancelTeamSubscriptionAsAdmin } from "@/lib/admin/team-billing-admin";
import {
  loadTeamLimitOverrides,
  setTeamLimitOverridesAsStaff,
  type TeamLimitOverridesView,
} from "@/lib/admin/team-limit-overrides";
import { requirePrincipal } from "@/lib/api/principal";
import type { v } from "@/lib/validation";
import {
  adminCancelTeamSubscriptionResultSchema,
  adminCancelTeamSubscriptionSchema,
  adminSetTeamLimitOverridesBodySchema,
  adminTeamIdParamSchema,
  adminTeamLimitsSchema,
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
  )
  .get(
    "/teams/:teamId/limits",
    ...adminOperation({
      operationId: "adminGetTeamLimits",
      tags: [ADMIN_API_TAGS.teams],
      summary: "Get a team's plan limits and staff overrides",
      description:
        "Returns the plan limits of one team: `planLimits` (the plan with its add-ons, or the "
        + "Free limits when `isActive` is false), `overrides` (only the keys that staff set, as "
        + "stored), `appliedOverrides` (the stored keys in effect now), and `limits` (what the "
        + "team gets). `isActive` false means a paid plan with no paid access, for example a "
        + "failed payment: the overrides are suspended, and only the keys below the Free values "
        + "stay in `appliedOverrides`. They apply again when the payment succeeds. "
        + "`hideFromCustomer` true means the customer dashboard shows no statement that the "
        + "limits are custom; the limits apply either way. The limits use the units of the plan "
        + "catalog.",
      scope: "admin:read",
      responses: {
        200: jsonResponse({ description: "The team's limits.", schema: adminTeamLimitsSchema }),
      },
    }),
    apiValidator("param", adminTeamIdParamSchema),
    async (c) => c.json(toAdminTeamLimitsDto(await loadTeamLimitOverrides({ teamId: c.req.valid("param").teamId }))),
  )
  .put(
    "/teams/:teamId/limit-overrides",
    ...adminOperation({
      operationId: "adminSetTeamLimitOverrides",
      tags: [ADMIN_API_TAGS.teams],
      summary: "Set or remove a team's plan limit overrides",
      description:
        "Replaces the staff limit overrides of one team, for a custom deal. `overrides` is the "
        + "full new set: a key that is absent goes back to the plan value, and `{}` removes every "
        + "override. An override replaces the plan value, add-ons included; it is not added to "
        + "it. It stays when the plan changes while the team pays. On a paid plan with no paid "
        + "access (for example a failed payment) it is suspended: only the keys below the Free "
        + "values apply, and the rest apply again when the payment succeeds. When the "
        + "subscription ends, every key at or above the Free value is removed for good. "
        + "`hideFromCustomer` true removes the \"Custom limits\" card from the customer billing "
        + "page, so nothing tells the customer that staff set the limits. It changes no limit: "
        + "refusals keep the effective values. Absent means false, and it is not stored with no "
        + "override. Each key has a minimum and a maximum; a value outside them is refused. A "
        + "lower limit deletes nothing: the team keeps its data and cannot add more. `reason` is "
        + "required and goes to the audit log with the change. Returns the limits as "
        + "`adminGetTeamLimits` does.",
      scope: "admin:write",
      responses: {
        200: jsonResponse({ description: "The team's limits with the new overrides.", schema: adminTeamLimitsSchema }),
      },
    }),
    apiValidator("param", adminTeamIdParamSchema),
    apiValidator("json", adminSetTeamLimitOverridesBodySchema),
    async (c) => {
      const { overrides, hideFromCustomer, reason } = c.req.valid("json");
      const view = await setTeamLimitOverridesAsStaff({
        teamId: c.req.valid("param").teamId,
        overrides,
        hideFromCustomer,
        reason,
        staffUserId: requirePrincipal().userId,
      });

      return c.json(toAdminTeamLimitsDto(view));
    },
  );

function toAdminTeamLimitsDto(view: TeamLimitOverridesView): v.InferOutput<typeof adminTeamLimitsSchema> {
  return {
    planId: view.planId,
    isActive: view.isActive,
    planLimits: view.planLimits,
    overrides: view.overrides,
    appliedOverrides: view.appliedOverrides,
    hideFromCustomer: view.hideFromCustomer,
    limits: view.limits,
  };
}
