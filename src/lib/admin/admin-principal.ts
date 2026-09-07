import "server-only";

import { ROLES_ENUM } from "@/app/enums";
import { getDB } from "@/db";
import { ActionError } from "@/lib/action-error";
import { isBanned } from "@/lib/account/ban";
import { hasScope, requirePrincipal, type ApiPrincipal } from "@/lib/api/principal";
import { ADMIN_SCOPE_NAMES, isAdminScope, type AdminScope } from "@/lib/api/admin-scopes";

// The one authorization gate for the internal admin API and MCP surfaces. Two independent facts
// must both hold: the credential carries the operation's `admin:*` scope, and the account behind
// it is an admin *right now*. Either alone is not enough — a scope is a snapshot of what was
// granted, a role is what the deployment currently believes.
//
// Both credential kinds reach here. An API key gets its scopes from `createAdminApiKey`; an OAuth
// token gets them from `clampAdminScopesForConsent`, which issues them only to a live admin
// consenting to a verified client. The role re-check below is what makes either safe to hold: it
// is re-read from D1 per request, so a demotion ends the credential's power immediately.

// Deliberately identical for "no admin scope" and "no longer an admin": a caller who is not staff
// must not be able to tell the two apart, since the difference would confirm that an internal
// scope exists and that this credential once held it. A live admin gets the specific message below.
const NOT_ADMIN_DETAIL = "This credential is not authorized for administrative operations.";

function missingAdminScopeDetail(scope: AdminScope): string {
  return `This credential is missing the required scope: ${scope}.`;
}

// The entry points that admit any internal scope name the whole set, because no single scope is
// the required one there.
const MISSING_ANY_ADMIN_SCOPE_DETAIL =
  `This credential is missing a required scope: one of ${ADMIN_SCOPE_NAMES.join(", ")}.`;

/**
 * Read from D1 rather than from `principal.user.role`. The principal's role travels on a KV
 * snapshot written under `API_KEY_CACHE_TTL_SECONDS`, so trusting it would leave a demoted admin's
 * key fully powered until that TTL lapsed. One indexed primary-key read per request is the price
 * of "demotion takes effect now", and this surface is low-volume staff tooling.
 */
export async function isLiveAdmin(userId: string): Promise<boolean> {
  const user = await getDB().query.userTable.findFirst({
    where: { id: userId },
    columns: { role: true, bannedAt: true },
  });

  // The ban is read from the same row as the role, so it costs nothing extra. Banning an admin is
  // refused anyway (staff demote first), which makes this the repair for a direct database ban.
  return user?.role === ROLES_ENUM.ADMIN && !isBanned(user);
}

/**
 * The half both guards below share, in the order both need: audience, then live role, with each
 * guard adding its own scope test. Every decision reads the principal passed in, never ambient
 * state. That is not tidiness: the callers run in different contexts. A route runs inside
 * `runWithPrincipal`, so it can default to the AsyncLocalStorage principal; the internal MCP server
 * asserts once while *building* a session, before any dispatch has entered that storage, and must
 * hand its principal over explicitly. Reading the store there returned nothing and threw, which is
 * a 500 rather than a refusal.
 */
async function assertLiveAdminPrincipal({
  principal,
}: {
  principal?: ApiPrincipal;
}): Promise<ApiPrincipal> {
  const caller = principal ?? requirePrincipal();

  // Admin scopes are account-only, so no team key can hold one; asserted against the principal
  // itself because this gate must not depend on another file's catalog flag staying correct.
  if (caller.audience.type !== "personal") {
    throw new ActionError("FORBIDDEN", NOT_ADMIN_DETAIL);
  }

  // Role before scope, and both refusals are the neutral sentence unless the caller is staff.
  if (!(await isLiveAdmin(caller.userId))) {
    throw new ActionError("FORBIDDEN", NOT_ADMIN_DETAIL);
  }

  return caller;
}

/**
 * Guard behind every admin operation, mounted by `adminOperation` ahead of the validators so a
 * credential that may not call an operation never learns its schema from a 400.
 */
export async function assertAdminPrincipal({
  scope,
  principal,
}: {
  scope: AdminScope;
  /** Omit inside a request, where `apiAuth` has already established the principal. */
  principal?: ApiPrincipal;
}): Promise<ApiPrincipal> {
  const caller = await assertLiveAdminPrincipal({ principal });

  if (!hasScope(caller, scope)) {
    throw new ActionError("FORBIDDEN", missingAdminScopeDetail(scope));
  }

  return caller;
}

/**
 * Guard for the entry points that admit any internal scope: the MCP session and the internal
 * document. Not `admin:read` specifically, because several operations declare `admin:write` alone,
 * so a write-only credential exists and must pass here.
 */
export async function assertAnyAdminPrincipal({
  principal,
}: {
  /** Omit inside a request, where `apiAuth` has already established the principal. */
  principal?: ApiPrincipal;
}): Promise<ApiPrincipal> {
  const caller = await assertLiveAdminPrincipal({ principal });

  if (!caller.scopes.some(isAdminScope)) {
    throw new ActionError("FORBIDDEN", MISSING_ANY_ADMIN_SCOPE_DETAIL);
  }

  return caller;
}
