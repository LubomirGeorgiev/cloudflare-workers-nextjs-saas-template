import "server-only";

import { adminApiDocumentResponse } from "@/api/admin/generated-document";
import { INTERNAL_API_DOCUMENT_CACHE_CONTROL } from "@/constants/cache-control";
import { ActionError } from "@/lib/action-error";
import { assertAnyAdminPrincipal, isLiveAdmin } from "@/lib/admin/admin-principal";
import { actionErrorToProblem, toProblemResponse } from "@/lib/api/errors";
import { principalFromBearerProps } from "@/lib/oauth/bearer-props";
import { getSessionFromRequestCookies } from "@/utils/auth";

// Two doors for `ADMIN_API_OPENAPI_PATH`: the OAuth provider refuses a cookie-only request before
// any handler runs, so `worker-entrypoint.ts` calls the cookie door on that 401 and the bearer door
// from inside the funnel. Not a Hono route, so the route-table audit stays absolute. Unadvertised.

const MISSING_CREDENTIAL =
  "The internal API document requires an authenticated administrator.";
const NOT_ADMIN =
  "This session is not authorized for administrative operations.";

// Every refusal carries the document's own cache directive: a refusal is decided per credential
// too, so no cache may serve one to a later request that would have been answered differently.
function refuse({ request, error }: { error: unknown; request: Request }): Response {
  const problem = actionErrorToProblem({ error, request });

  problem.headers["cache-control"] = INTERNAL_API_DOCUMENT_CACHE_CONTROL;

  return toProblemResponse(problem);
}

/**
 * The refusal for a method that never serves the document. It replaces the provider's own 401,
 * which carries a `WWW-Authenticate` challenge naming this path — the endpoint stays unadvertised
 * on every method, not only on the two that read it.
 */
export function adminOpenApiRefusalResponse(request: Request): Response {
  return refuse({ request, error: new ActionError("NOT_AUTHORIZED", MISSING_CREDENTIAL) });
}

/** Cookie door. `isLiveAdmin` re-reads D1 so a demotion ends readability now, not when the snapshot lapses. */
export async function adminOpenApiCookieResponse(request: Request): Promise<Response> {
  const session = await getSessionFromRequestCookies(request);

  if (!session) {
    return adminOpenApiRefusalResponse(request);
  }

  if (!(await isLiveAdmin(session.userId))) {
    return refuse({ request, error: new ActionError("FORBIDDEN", NOT_ADMIN) });
  }

  return adminApiDocumentResponse();
}

/** Bearer door. Any `admin:*` scope reads the document: a write-only key is mintable and must see it. */
// fallow-ignore-next-line unused-export -- Reached through a lazy `import()` in worker-entrypoint.ts.
export async function adminOpenApiBearerResponse({
  props,
  request,
}: {
  props: unknown;
  request: Request;
}): Promise<Response> {
  try {
    const principal = await principalFromBearerProps(props);

    if (!principal) {
      throw new ActionError("NOT_AUTHORIZED", MISSING_CREDENTIAL);
    }

    await assertAnyAdminPrincipal({ principal });

    return adminApiDocumentResponse();
  } catch (error) {
    return refuse({ request, error });
  }
}
