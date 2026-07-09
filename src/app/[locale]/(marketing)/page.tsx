import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Hero } from "@/components/landing/hero";
import { Stack } from "@/components/landing/stack";
import { Features } from "@/components/landing/features";
import { CallToAction } from "@/components/landing/cta";
import { FAQ } from "@/components/landing/faq";
import { LOCALES, type Locale } from "@/i18n/config";
import { buildAlternates } from "@/utils/i18n-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Client.Landing.meta" });

  return {
    title: t("title"),
    description: t("description"),
    alternates: buildAlternates({ pathname: "/", locale, availableLocales: LOCALES }),
  };
}

export default function Home() {
  return (
    <>
      <Hero />
      <Stack />
      <Features />
      <CallToAction />
      <FAQ />
    </>
  );
}
