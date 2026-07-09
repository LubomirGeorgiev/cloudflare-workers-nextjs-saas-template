import { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import VerifyEmailClientComponent from "./verify-email.client";
import { REDIRECT_AFTER_SIGN_IN } from "@/constants";
import { redirectAuthenticatedUser } from "@/utils/auth-redirect";
import { LOCALES, type Locale } from "@/i18n/config";
import { buildAlternates } from "@/utils/i18n-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Client.Auth.VerifyEmail.meta" });

  return {
    title: t("title"),
    description: t("description"),
    alternates: buildAlternates({ pathname: "/verify-email", locale, availableLocales: LOCALES }),
  };
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const token = (await searchParams).token;

  await redirectAuthenticatedUser({
    redirectPath: REDIRECT_AFTER_SIGN_IN,
    shouldRedirect: (session) => Boolean(session.user.emailVerified),
  });

  if (!token) {
    return redirect('/sign-in');
  }

  return <VerifyEmailClientComponent />;
}
