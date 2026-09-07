import "server-only";

import { Hono } from "hono";

import { adminBlockedEmailRoutes } from "@/api/admin/routes/blocked-emails";
import { adminCmsRoutes } from "@/api/admin/routes/cms";
import { adminOAuthAppRoutes } from "@/api/admin/routes/oauth-apps";
import { adminSystemRoutes } from "@/api/admin/routes/system";
import { adminTeamRoutes } from "@/api/admin/routes/teams";
import { adminUserRoutes } from "@/api/admin/routes/users";
import { apiAuth } from "@/api/middleware/auth";
import { problemJsonErrorHandler, problemJsonNotFoundHandler } from "@/api/middleware/problem-json";
import { authedRateLimit } from "@/api/middleware/rate-limit";
import type { ApiApp, ApiEnv } from "@/api/types";
import { ADMIN_API_BASE_PATH } from "@/constants";

// The internal admin API. A second Hono app rather than more routers on `src/api/index.ts`, so the
// two surfaces cannot share a document, a scope type, or a route table — see `ADMIN_SCOPES` in
// `src/lib/api/scopes.ts` for why that separation is the mechanism and not just tidiness.
//
// It reuses the public app's whole middleware chain deliberately: bearer auth, the principal bridge
// into the service layer, per-credential rate limiting, and problem+json errors are all one
// implementation, so an admin credential is resolved by exactly the code that resolves every other.
//
// No `/openapi.json` route here, ever. `ADMIN_API_OPENAPI_PATH` is answered by `worker-entrypoint.ts`
// through `src/api/admin/openapi-endpoint.ts`, so every route mounted below went through
// `adminOperation`, which is what the route-table audit checks.

// ---------------------------------------------------------------------------
// Extension seam for downstream projects.
//
// Mount your own internal routers here. Declare each route with `...adminOperation({ ... })` from
// `@/api/admin/operation`, which takes an `AdminScope` and mounts `assertAdminPrincipal` — the
// route table is audited for it, and a public `ApiScope` is not even expressible.
// ---------------------------------------------------------------------------
// oxlint-disable project/no-unused-module-exports -- Template extension point.
// fallow-ignore-next-line unused-export -- Intentionally empty until a fork mounts its own routes.
export function registerCustomAdminRoutes(__app: ApiApp): void {}
// oxlint-enable project/no-unused-module-exports

function createAdminApiApp(): ApiApp {
  const app = new Hono<ApiEnv>().basePath(ADMIN_API_BASE_PATH);

  app.onError(problemJsonErrorHandler);
  app.notFound(problemJsonNotFoundHandler);

  app.use("*", apiAuth);
  app.use("*", authedRateLimit);

  app.route("/", adminUserRoutes);
  app.route("/", adminBlockedEmailRoutes);
  app.route("/", adminTeamRoutes);
  app.route("/", adminOAuthAppRoutes);
  app.route("/", adminCmsRoutes);
  app.route("/", adminSystemRoutes);

  registerCustomAdminRoutes(app);

  return app;
}

export const adminApiApp = createAdminApiApp();
