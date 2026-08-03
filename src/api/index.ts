import "server-only";

import { Hono } from "hono";

import { apiAuth } from "@/api/middleware/auth";
import { problemJsonErrorHandler, problemJsonNotFoundHandler } from "@/api/middleware/problem-json";
import { authedRateLimit } from "@/api/middleware/rate-limit";
import { apiKeyRoutes } from "@/api/routes/api-keys";
import { billingRoutes } from "@/api/routes/billing";
import { invitationRoutes } from "@/api/routes/invitations";
import { memberRoutes } from "@/api/routes/members";
import { meRoutes } from "@/api/routes/me";
import { teamRoutes } from "@/api/routes/teams";
import type { ApiApp, ApiEnv } from "@/api/types";
import { API_V1_BASE_PATH } from "@/constants";

const OPENAPI_ROUTE = "/openapi.json";

// ---------------------------------------------------------------------------
// Extension seam for downstream projects.
//
// Mount your own routers here (`app.route("/", myRoutes)`) and they inherit the whole chain:
// bearer auth, the principal bridge into the service layer, per-credential rate limiting, and
// problem+json errors.
//
// Declare each route with `...apiOperation({ ..., scope, audience, responses })` from
// `@/api/operation`, spread ahead of its validators: that one declaration documents the operation,
// exposes it as an MCP tool, and mounts its guard. The route table is audited for it.
// ---------------------------------------------------------------------------
// oxlint-disable project/no-unused-module-exports -- Template extension point.
// fallow-ignore-next-line unused-export -- Intentionally empty until a fork mounts its own routes.
export function registerCustomRoutes(__app: ApiApp): void {}
// oxlint-enable project/no-unused-module-exports

function createApiApp(): ApiApp {
  const app = new Hono<ApiEnv>().basePath(API_V1_BASE_PATH);

  app.onError(problemJsonErrorHandler);
  app.notFound(problemJsonNotFoundHandler);

  // Registered before the auth middleware on purpose: Hono only applies middleware to routes
  // registered after it, which is what keeps the discovery document publicly readable.
  // The prebuilt bytes go out verbatim: `c.json` would re-serialize the whole document per request.
  app.get(OPENAPI_ROUTE, async (c) => {
    // Lazy so this app never statically reaches the document the generator builds *from* this app,
    // and so no other route evaluates those bytes.
    const { apiDocumentJson } = await import("@/api/generated-document");

    return c.body(apiDocumentJson, 200, { "content-type": "application/json" });
  });

  app.use("*", apiAuth);
  app.use("*", authedRateLimit);

  app.route("/", meRoutes);
  app.route("/", teamRoutes);
  app.route("/", memberRoutes);
  app.route("/", invitationRoutes);
  app.route("/", billingRoutes);
  app.route("/", apiKeyRoutes);

  registerCustomRoutes(app);

  return app;
}

export const apiApp = createApiApp();
