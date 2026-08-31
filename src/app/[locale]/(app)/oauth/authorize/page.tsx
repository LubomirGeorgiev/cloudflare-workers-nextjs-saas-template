import { getTranslations } from "next-intl/server";

import { ROLES_ENUM } from "@/app/enums";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ADMIN_OAUTH_APPS_PATH, OAUTH_AUTHORIZE_PATH } from "@/constants";
import { requestedAdminScopes } from "@/lib/api/admin-scopes";
import { resolveConsentRequest } from "@/lib/oauth/consent";
import { getCurrentSession } from "@/utils/auth";
import { redirectToSignIn } from "@/utils/auth-redirect";
import { ConsentClient } from "./consent.client";

export async function generateMetadata() {
  const t = await getTranslations("Client.OAuth");
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    robots: { index: false, follow: false },
  };
}

/** The authorization request exactly as it arrived, so the client's flow resumes untouched. */
function toAuthQuery(params: Record<string, string | string[] | undefined>): URLSearchParams {
  const authQuery = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    for (const single of [value].flat()) {
      if (single !== undefined) {
        authQuery.append(key, single);
      }
    }
  }

  return authQuery;
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, session] = await Promise.all([searchParams, getCurrentSession()]);

  const authQuery = toAuthQuery(params);

  // Same guard as the dashboard, with the full authorization request preserved so the client's
  // flow resumes untouched after sign-in.
  if (!session) {
    return redirectToSignIn(`${OAUTH_AUTHORIZE_PATH}?${authQuery.toString()}`);
  }

  const isAdmin = session.user.role === ROLES_ENUM.ADMIN;

  let consent;
  try {
    consent = await resolveConsentRequest({ authQuery: authQuery.toString(), isAdmin });
  } catch {
    // Answered on this page, never bounced back to the caller: see `InvalidAuthorizationRequest`
    // below for why, and for why the admin hint stays behind the role check.
    const askedForAdminScopes =
      requestedAdminScopes(authQuery.get("scope")?.split(" ") ?? []).length > 0;

    return <InvalidAuthorizationRequest showAdminHint={isAdmin && askedForAdminScopes} />;
  }

  return (
    <main className="container mx-auto flex min-h-screen max-w-lg items-center px-4 py-10">
      <ConsentClient
        authQuery={authQuery.toString()}
        clientName={consent.clientName}
        logoUri={consent.logoUri}
        isVerified={consent.isVerified}
        grantedScopes={consent.grantedScopes}
        droppedScopes={consent.droppedScopes}
        adminScopeDescriptions={consent.adminScopeDescriptions}
        adminScopesToVerify={consent.adminScopesToVerify}
        redirectHost={consent.redirectHost}
        cimdHost={consent.cimdHost}
        clientId={consent.clientId}
        isLoopbackRedirect={consent.isLoopbackRedirect}
        userEmail={session.user.email ?? ""}
      />
    </main>
  );
}


/**
 * The refusal for an unknown client or an unregistered redirect URI, which must never be bounced
 * back to the caller — that is exactly the open redirect an authorization server has to refuse.
 *
 * The admin hint is shown only to an admin whose request was asking for internal scopes. This
 * refusal means the client is unknown, which for an agent client usually means its metadata
 * document could not be fetched; naming the next step saves an admin working out why a connection
 * that looks correct is rejected. It stays behind the role check so the internal catalog is never
 * revealed to anyone else.
 */
async function InvalidAuthorizationRequest({ showAdminHint }: { showAdminHint: boolean }) {
  const t = await getTranslations("Client.OAuth");

  return (
    <main className="container mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 px-4">
      <Alert variant="destructive">
        <AlertTitle>{t("invalidRequestTitle")}</AlertTitle>
        <AlertDescription>{t("invalidRequestDescription")}</AlertDescription>
      </Alert>

      {showAdminHint ? (
        <Alert>
          <AlertTitle>{t("adminHintTitle")}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{t("adminHintUnknownClient")}</p>
            <p>
              {t.rich("adminHintVerifyNext", {
                path: ADMIN_OAUTH_APPS_PATH,
                code: (chunks) => <code className="font-mono text-xs">{chunks}</code>,
              })}
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
    </main>
  );
}
