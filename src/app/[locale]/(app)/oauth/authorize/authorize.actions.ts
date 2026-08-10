"use server";

import { ActionError } from "@/lib/action-error";
import {
  buildDenialRedirect,
  persistApprovedOAuthApp,
  resolveConsentRequest,
} from "@/lib/oauth/consent";
import { getOAuthHelpers } from "@/lib/oauth/provider-api";
import { actionClient } from "@/lib/safe-action";
import { oauthConsentSchema } from "@/schemas/oauth.schema";
import { requireVerifiedEmail } from "@/utils/auth";
import { RATE_LIMITS } from "@/utils/with-rate-limit";
import { withUserRateLimit } from "@/utils/with-user-rate-limit";

// Returns the URL to send the browser to rather than redirecting itself: the destination is the
// third-party client's callback, which `next/navigation`'s redirect cannot leave the app for.
export const decideConsentAction = actionClient
  .inputSchema(oauthConsentSchema)
  .action(async ({ parsedInput: input }) => {
    return withUserRateLimit(async () => {
      const session = await requireVerifiedEmail();
      const consent = await resolveConsentRequest(input.authQuery);

      if (input.decision === "deny") {
        const redirectTo = buildDenialRedirect(consent.authRequest);
        if (!redirectTo) {
          throw new ActionError("PRECONDITION_FAILED", { key: "Client.OAuth.errorMissingRedirect" });
        }

        return { redirectTo };
      }

      await persistApprovedOAuthApp(consent);

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

      return { redirectTo };
    }, RATE_LIMITS.SETTINGS);
  });
