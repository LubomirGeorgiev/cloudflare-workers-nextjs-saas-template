import { Metadata } from "next";
import { getTranslator } from "@/i18n/translator";
import GoogleCallbackClientComponent from "./google-callback.client";
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
  const t = await getTranslator({ locale, namespace: "Client.Auth.GoogleCallback.meta" });

  return {
    title: t("title"),
    description: t("description"),
    alternates: buildAlternates({ pathname: "/sso/google/callback", locale, availableLocales: LOCALES }),
  };
}

export default async function GoogleCallbackPage() {
  await redirectAuthenticatedUser({ redirectPath: REDIRECT_AFTER_SIGN_IN });

  return <GoogleCallbackClientComponent />;
}
