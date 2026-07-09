import { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCloudflareContext } from "@/utils/cloudflare-context";
import ResetPasswordClientComponent from "./reset-password.client";
import { getResetTokenKey } from "@/utils/auth-utils";
import { LOCALES, type Locale } from "@/i18n/config";
import { buildAlternates } from "@/utils/i18n-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Client.Auth.ResetPassword.meta" });

  return {
    title: t("title"),
    description: t("description"),
    alternates: buildAlternates({ pathname: "/reset-password", locale, availableLocales: LOCALES }),
  };
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const token = (await searchParams).token;

  if (!token) {
    return notFound();
  }

  const { env } = await getCloudflareContext();

  if (!env?.NEXT_INC_CACHE_KV) {
    throw new Error("Can't connect to KV store");
  }

  const resetTokenStr = await env.NEXT_INC_CACHE_KV.get(getResetTokenKey(token));

  if (!resetTokenStr) {
    return notFound();
  }

  return <ResetPasswordClientComponent />;
}
