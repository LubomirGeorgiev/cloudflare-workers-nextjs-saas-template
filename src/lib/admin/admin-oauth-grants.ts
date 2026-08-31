import "server-only";

import { isAdminScope } from "@/lib/api/admin-scopes";
import {
  listConnectedApps,
  listConnectedAppsForUser,
  revokeConnectedAppForUser,
  type ConnectedApp,
} from "@/lib/oauth/connected-apps";
import { requireAdmin, requireVerifiedEmail } from "@/utils/auth";
import { mapInBatches } from "@/utils/map-in-batches";

// Each revocation is a provider write plus a KV cache delete, so the fan-out has to stay inside the
// Worker subrequest budget. Small on purpose: a user holds a handful of internal grants, not a page.
const GRANT_REVOKE_BATCH_SIZE = 5;

// The other half of "who can reach the internal surface": an agent client signed in through the
// consent screen. Deliberately its own module rather than living beside the key helpers — reaching
// the OAuth provider pulls `cloudflare:workers` in, and `src/lib/admin/users.ts` is on the internal
// API's own module graph, which the build-time OpenAPI generator evaluates outside workerd.
//
// Keys and grants are different stores anyway: a key is a row in `api_key`, a grant is provider
// state in KV. Only the admin page and `setUserRole` read this file, and `setUserRole` reaches it
// through a dynamic import to keep it off that generator's graph.

/**
 * The caller's own OAuth grants carrying an internal scope.
 *
 * Only the caller's own, matching the key listing. To see another user's, open them from the Users
 * page — that view lists every credential they hold.
 */
export async function listAdminOAuthGrants(): Promise<ConnectedApp[]> {
  await requireAdmin();

  const apps = await listConnectedApps();

  return apps.filter((app) => app.scopes.some(isAdminScope));
}

/**
 * Revoking kills the grant and every token minted from it. `revokeConnectedAppForUser` scopes the
 * delete to the user id, so a grant belonging to anyone else is a no-op rather than an error.
 */
export async function revokeAdminOAuthGrant({ grantId }: { grantId: string }): Promise<void> {
  await requireAdmin();
  const session = await requireVerifiedEmail();

  await revokeConnectedAppForUser({ grantId, userId: session.userId });
}

/**
 * Revoke every OAuth grant of a user that carries an internal scope, for the demotion path in
 * `setUserRole`. The grant half of the same cleanup `revokeInternalApiKeysForUser` does for keys.
 *
 * The live role check already makes such a grant powerless, so this is hygiene: without it the
 * demoted user keeps seeing `admin:*` on their own account-settings page, and a later promotion
 * hands the client its internal scopes back with no fresh consent.
 *
 * Carries no authorization of its own — `setUserRole` proves admin first, and revocation is scoped
 * to `userId`. The listing it reads is page-bounded, and the revocations run in small batches, so
 * neither half can fan out without a limit.
 */
export async function revokeInternalOAuthGrantsForUser(userId: string): Promise<number> {
  const apps = await listConnectedAppsForUser({ userId });
  const internal = apps.filter((app) => app.scopes.some(isAdminScope));

  await mapInBatches({
    items: internal,
    batchSize: GRANT_REVOKE_BATCH_SIZE,
    fn: (app) => revokeConnectedAppForUser({ grantId: app.grantId, userId }),
  });

  return internal.length;
}
