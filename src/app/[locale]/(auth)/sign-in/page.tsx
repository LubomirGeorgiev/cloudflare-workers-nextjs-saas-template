import type { Metadata } from "next";
import { getTranslator } from "@/i18n/translator";
import SignInClientPage from "./sign-in.client";
import { getSafeRedirectPath, redirectAuthenticatedUser } from "@/utils/auth-redirect";
import { LOCALES, type Locale } from "@/i18n/config";
import { buildAlternates } from "@/utils/i18n-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslator({ locale, namespace: "Client.Auth.SignIn.meta" });

  return {
    title: t("title"),
    description: t("description"),
    alternates: buildAlternates({ pathname: "/sign-in", locale, availableLocales: LOCALES }),
  };
}

const SignInPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string }>;
}) => {
  const { redirect: redirectParam } = await searchParams;
  const redirectPath = getSafeRedirectPath({ value: redirectParam });

  await redirectAuthenticatedUser({ redirectPath });

  return (
    <SignInClientPage redirectPath={redirectPath} />
  )
}

export default SignInPage;
