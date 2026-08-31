import "server-only";

import { Hono } from "hono";

import { ADMIN_API_TAGS } from "@/api/admin/openapi-document";
import { adminOperation } from "@/api/admin/operation";
import { apiValidator } from "@/api/middleware/problem-json";
import { jsonResponse } from "@/api/openapi";
import type { ApiEnv } from "@/api/types";
import { listOAuthApps, setOAuthAppVerified } from "@/lib/oauth/oauth-apps";
import { ActionError } from "@/lib/action-error";
import { v } from "@/lib/validation";
import {
  adminListOAuthAppsQuerySchema,
  adminOAuthAppClientIdParamSchema,
  adminOAuthAppListSchema,
  adminOAuthAppSchema,
  adminSetOAuthAppVerifiedSchema,
} from "@/schemas/api/admin.schema";

type OAuthAppResponse = v.InferOutput<typeof adminOAuthAppSchema>;

type OAuthApp = NonNullable<Awaited<ReturnType<typeof setOAuthAppVerified>>>;

// `verifiedAt` is the stored fact; `isVerified` is the decision every caller actually reads, so
// both are published rather than making a client re-derive one from the other.
function toOAuthAppResponse(app: OAuthApp): OAuthAppResponse {
  return {
    clientId: app.clientId,
    name: app.name,
    isVerified: app.verifiedAt !== null,
    registrationSource: app.registrationSource,
    redirectUris: app.redirectUris,
    verifiedAt: app.verifiedAt ? app.verifiedAt.toISOString() : null,
    createdAt: app.createdAt.toISOString(),
  };
}

export const adminOAuthAppRoutes = new Hono<ApiEnv>()
  .get(
    "/oauth-apps",
    ...adminOperation({
      operationId: "adminListOAuthApps",
      tags: [ADMIN_API_TAGS.oauthApps],
      summary: "List registered OAuth apps",
      description:
        "Lists every OAuth client registered against this deployment, newest first, including " +
        "self-registered DCR clients. `isVerified` decides the consent scope tier a client may " +
        "request: unverified clients are clamped to a reduced set of scopes.",
      scope: "admin:read",
      responses: {
        200: jsonResponse({ description: "A page of OAuth apps.", schema: adminOAuthAppListSchema }),
      },
    }),
    apiValidator("query", adminListOAuthAppsQuerySchema),
    async (c) => {
      const { page, pageSize } = c.req.valid("query");
      const { apps, totalCount } = await listOAuthApps({ page, pageSize });

      return c.json({
        apps: apps.map(toOAuthAppResponse),
        totalCount,
        page,
        pageSize,
        totalPages: Math.ceil(totalCount / pageSize),
      } satisfies v.InferOutput<typeof adminOAuthAppListSchema>);
    },
  )
  .put(
    "/oauth-apps/:clientId/verification",
    ...adminOperation({
      operationId: "adminSetOAuthAppVerified",
      tags: [ADMIN_API_TAGS.oauthApps],
      summary: "Verify or unverify an OAuth app",
      description:
        "Marks a registered OAuth client as verified or removes that mark. Verifying lifts the " +
        "anti-phishing scope ceiling applied to self-registered clients, and opts an expiring DCR " +
        "registration into renewal. Unverifying re-applies the ceiling to future consent requests; " +
        "it does not revoke grants a user has already approved.",
      scope: "admin:write",
      responses: {
        200: jsonResponse({ description: "The updated OAuth app.", schema: adminOAuthAppSchema }),
      },
    }),
    apiValidator("param", adminOAuthAppClientIdParamSchema),
    apiValidator("json", adminSetOAuthAppVerifiedSchema),
    async (c) => {
      const { clientId } = c.req.valid("param");
      const { isVerified } = c.req.valid("json");

      // The UPDATE reports whether the row existed, so an unknown client answers 404 rather than a
      // silently-successful no-op, and one round trip serves both the check and the response.
      const app = await setOAuthAppVerified({ clientId, isVerified });
      if (!app) {
        throw new ActionError("NOT_FOUND", "OAuth app not found");
      }

      return c.json(toOAuthAppResponse(app));
    },
  );
