import { getTranslations } from "next-intl/server";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { OAUTH_AUTHORIZE_PATH } from "@/constants";
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

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, session, t] = await Promise.all([
    searchParams,
    getCurrentSession(),
    getTranslations("Client.OAuth"),
  ]);

  const authQuery = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const single of Array.isArray(value) ? value : [value]) {
      if (single !== undefined) {
        authQuery.append(key, single);
      }
    }
  }

  // Same guard as the dashboard, with the full authorization request preserved so the client's
  // flow resumes untouched after sign-in.
  if (!session) {
    return redirectToSignIn(`${OAUTH_AUTHORIZE_PATH}?${authQuery.toString()}`);
  }

  let consent;
  try {
    consent = await resolveConsentRequest(authQuery.toString());
  } catch {
    // A bad client_id or an unregistered redirect_uri must never be bounced back to the caller —
    // that is exactly the open-redirect an authorization server has to refuse.
    return (
      <main className="container mx-auto flex min-h-screen max-w-lg items-center px-4">
        <Alert variant="destructive">
          <AlertTitle>{t("invalidRequestTitle")}</AlertTitle>
          <AlertDescription>{t("invalidRequestDescription")}</AlertDescription>
        </Alert>
      </main>
    );
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
        redirectHost={consent.redirectHost}
        cimdHost={consent.cimdHost}
        userEmail={session.user.email ?? ""}
      />
    </main>
  );
}
