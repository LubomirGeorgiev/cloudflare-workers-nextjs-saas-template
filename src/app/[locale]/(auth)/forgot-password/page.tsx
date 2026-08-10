import { Metadata } from "next";
import { getTranslator } from "@/i18n/translator";
import ForgotPasswordClientComponent from "./forgot-password.client";
import { LOCALES, type Locale } from "@/i18n/config";
import { buildAlternates } from "@/utils/i18n-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslator({ locale, namespace: "Client.Auth.ForgotPassword.meta" });

  return {
    title: t("title"),
    description: t("description"),
    alternates: buildAlternates({ pathname: "/forgot-password", locale, availableLocales: LOCALES }),
  };
}

export default function ForgotPasswordPage() {
  return <ForgotPasswordClientComponent />;
}
