"use server";

import { ActionError } from "@/lib/action-error";
import { isLiveAdmin } from "@/lib/admin/admin-principal";
import {
  GRANT_REVOKE_BATCH_SIZE,
  listConnectedAppsForUser,
  revokeConnectedAppForUser,
  selectGrantCapEvictions,
} from "@/lib/oauth/connected-apps";
import {
  buildDenialRedirect,
  ensureOAuthAppRecord,
  persistApprovedOAuthApp,
  resolveConsentRequest,
} from "@/lib/oauth/consent";
import { getOAuthHelpers } from "@/lib/oauth/provider-api";
import { actionClient } from "@/lib/safe-action";
import { setOAuthAppVerified } from "@/lib/oauth/oauth-apps";
import { oauthConsentSchema, oauthVerifyClientSchema } from "@/schemas/oauth.schema";
import { requireAdmin, requireVerifiedEmail } from "@/utils/auth";
import { mapInBatches } from "@/utils/map-in-batches";
import { RATE_LIMITS } from "@/utils/with-rate-limit";
import { withUserRateLimit } from "@/utils/with-user-rate-limit";

// Returns the URL to send the browser to rather than redirecting itself: the destination is the
// third-party client's callback, which `next/navigation`'s redirect cannot leave the app for.
export const decideConsentAction = actionClient
  .inputSchema(oauthConsentSchema)
  .action(async ({ parsedInput: input }) => {
    return withUserRateLimit(async () => {
      const session = await requireVerifiedEmail();
      // The session carries a role snapshot, so a demotion made straight in D1 would still widen
      // this grant. Re-read the live role, the same rule the internal API applies per request.
      const consent = await resolveConsentRequest({
        authQuery: input.authQuery,
        isAdmin: await isLiveAdmin(session.userId),
      });

      if (input.decision === "deny") {
        const redirectTo = buildDenialRedirect(consent.authRequest);
        if (!redirectTo) {
          throw new ActionError("PRECONDITION_FAILED", { key: "Client.OAuth.errorMissingRedirect" });
        }

        return { redirectTo };
      }

      await persistApprovedOAuthApp(consent);

      // Listed here rather than trusted from the browser, and again on the page for the warning.
      const { replaced, evicted } = selectGrantCapEvictions({
        apps: await listConnectedAppsForUser({ userId: session.userId }),
        clientId: consent.authRequest.clientId,
      });

      // `scope` is the clamped set re-derived server-side, never the browser's copy. Props stay
      // minimal — the principal is rebuilt per request — and metadata records what was approved,
      // since a client may rename itself later.
      const { redirectTo } = await getOAuthHelpers().completeAuthorization({
        request: consent.authRequest,
        userId: session.userId,
        scope: consent.grantedScopes,
        props: {
          credentialKind: "oauth-grant",
          userId: session.userId,
          clientId: consent.authRequest.clientId,
        },
        metadata: {
          createdAt: Date.now(),
          clientNameAtConsent: consent.clientName,
        },
      });

      // Mint first, then clean up: the grant is durable, so no follow-up may fail this response,
      // and a brief overshoot of the cap drains on the next consent.
      await mapInBatches({
        items: [...evicted, ...replaced],
        batchSize: GRANT_REVOKE_BATCH_SIZE,
        fn: (app) =>
          revokeConnectedAppForUser({ grantId: app.grantId, userId: session.userId })
            .catch((error: unknown) => {
              console.error(`Failed to revoke OAuth grant ${app.grantId}`, error);
            }),
      });

      return { redirectTo };
    }, RATE_LIMITS.SETTINGS);
  });


/**
 * Verify the client this authorization request came from, from the consent screen itself.
 *
 * Only a live admin can call it, and only the client named by the re-validated request — the
 * browser's copy of the id is never trusted, exactly as the approve path never trusts its copy of
 * the scopes. A missing app row is created first, because a CIMD client has no provider-side record
 * until someone approves it and verification would have nothing to mark.
 */
export const verifyConsentClientAction = actionClient
  .inputSchema(oauthVerifyClientSchema)
  .action(async ({ parsedInput: input }) => {
    return withUserRateLimit(async () => {
      // `requireAdmin` proves the session; the live read proves the role is still admin right now.
      const session = await requireAdmin();

      if (!session || !(await isLiveAdmin(session.userId))) {
        throw new ActionError("FORBIDDEN", { key: "Client.Errors.notAuthorized" });
      }

      const consent = await resolveConsentRequest({ authQuery: input.authQuery, isAdmin: true });

      await ensureOAuthAppRecord(consent);
      await setOAuthAppVerified({ clientId: consent.authRequest.clientId, isVerified: true });

      return { clientId: consent.authRequest.clientId };
    }, RATE_LIMITS.SETTINGS);
  });
