import { Metadata } from "next";
import { getCurrentSession } from "@/utils/auth";
import { redirect } from "@/i18n/navigation";
import { getTranslator } from "@/i18n/translator";
import TeamInviteClientComponent from "./team-invite.client";
import { LOCALES, type Locale } from "@/i18n/config";
import { buildAlternates } from "@/utils/i18n-metadata";
import { TEAM_INVITE_PATH } from "@/constants";
import { getTeamInviteSignInPath } from "@/lib/teams/team-invite-links";
import { SessionHydrator } from "@/components/session-hydrator";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslator({ locale, namespace: "Client.Auth.TeamInvite.meta" });

  return {
    title: t("title"),
    description: t("description"),
    alternates: buildAlternates({ pathname: TEAM_INVITE_PATH, locale, availableLocales: LOCALES }),
  };
}

export default async function TeamInvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const { locale } = await params;
  const session = await getCurrentSession();
  const token = (await searchParams)?.token;

  // If no token is provided, redirect to sign in
  if (!token) {
    return redirect({ href: "/sign-in", locale });
  }

  // If user is not logged in, redirect to sign in with return URL
  if (!session) {
    return redirect({ href: getTeamInviteSignInPath(token), locale });
  }

  // The (auth) layout has no SessionHydrator. A signed-in user can open the invite link directly, so
  // fill the store from this render; the header and EmailVerificationDialog read it.
  return (
    <SessionHydrator session={session}>
      <TeamInviteClientComponent currentEmail={session.user.email} />
    </SessionHydrator>
  );
}
