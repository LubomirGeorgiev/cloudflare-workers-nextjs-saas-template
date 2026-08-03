import "server-only";

import type { Context } from "hono";

import type { ApiEnv } from "@/api/types";
import type { ApiOperationAudience } from "@/lib/api/audience";
import { assertAccountAudience, assertTeamAudience } from "@/lib/api/principal";

// Who may call an operation, given the credential's own audience. Declared per operation next to
// its scope (see `src/api/operation.ts`), which composes this into the one guard a route mounts.
// The vocabulary itself lives in `@/lib/api/audience`, which the document readers share.

/** Team-scoped routes address their team through this path parameter. */
const TEAM_ID_PARAM = "teamId";

// `account`: a team-scoped API key is refused with 403. `team`: the operation addresses one team,
// re-checked inside `requireTeamPermission`, but refusing here keeps it ahead of body validation.
// `any`: both may call it; what a team credential sees is narrowed by the service layer.
export function audienceGuard(
  audience: ApiOperationAudience,
): (c: Context<ApiEnv>) => void {
  if (audience === "account") {
    return () => assertAccountAudience();
  }
  if (audience === "team") {
    return (c) => assertTeamAudience(c.req.param(TEAM_ID_PARAM));
  }

  return () => {};
}
