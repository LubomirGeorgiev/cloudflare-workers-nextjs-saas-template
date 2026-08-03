import "server-only";

import { Hono } from "hono";

import { teamIdParam } from "@/api/middleware/problem-json";
import { apiOperation } from "@/api/operation";
import { API_TAGS } from "@/api/openapi-document";
import { jsonResponse } from "@/api/openapi";
import type { ApiEnv } from "@/api/types";
import { getTeamBillingSummary } from "@/lib/billing/team-billing";

import { teamBillingSchema } from "@/schemas/api/teams.schema";

export const billingRoutes = new Hono<ApiEnv>()
  .get(
    "/teams/:teamId/billing",
    ...apiOperation({
      operationId: "getTeamBilling",
      tags: [API_TAGS.billing],
      summary: "Get a team's subscription",
      description:
        "Read-only summary of a team's plan, subscription status, billing interval, add-on units, " +
        "and renewal date. Requires the `access_billing` permission. Checkout and plan changes are " +
        "not exposed over the API.",
      scope: "billing:read",
      audience: "team",
      responses: {
        200: jsonResponse({ description: "The team's subscription.", schema: teamBillingSchema }),
      },
    }),
    teamIdParam(),
    async (c) => {
      return c.json(await getTeamBillingSummary(c.req.valid("param").teamId));
    },
  );
