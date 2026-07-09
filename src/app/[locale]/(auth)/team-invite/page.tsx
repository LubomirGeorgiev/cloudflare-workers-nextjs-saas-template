import { Metadata } from "next";
import { getSessionFromCookie } from "@/utils/auth";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import TeamInviteClientComponent from "./team-invite.client";
import { LOCALES, type Locale } from "@/i18n/config";
import { buildAlternates } from "@/utils/i18n-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Client.Auth.TeamInvite.meta" });

  return {
    title: t("title"),
    description: t("description"),
    alternates: buildAlternates({ pathname: "/team-invite", locale, availableLocales: LOCALES }),
  };
}

export default async function TeamInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const session = await getSessionFromCookie();
  const token = (await searchParams)?.token;

  // If no token is provided, redirect to sign in
  if (!token) {
    return redirect('/sign-in');
  }

  // If user is not logged in, redirect to sign in with return URL
  if (!session) {
    const returnUrl = `/team-invite?token=${token}`;
    return redirect(`/sign-in?redirect=${encodeURIComponent(returnUrl)}`);
  }

  return <TeamInviteClientComponent />;
}
