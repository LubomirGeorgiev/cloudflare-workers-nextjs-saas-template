import { Metadata } from "next";
import { getTranslator } from "@/i18n/translator";
import { Hero } from "@/components/landing/hero";
import { Stack } from "@/components/landing/stack";
import { Features } from "@/components/landing/features";
import { CallToAction } from "@/components/landing/cta";
import { FAQ } from "@/components/landing/faq";
import { LOCALES, type Locale } from "@/i18n/config";
import { buildAlternates } from "@/utils/i18n-metadata";

// Cached for an hour — see docs/page-caching.md.
export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslator({ locale, namespace: "Landing.meta" });

  return {
    title: t("title"),
    description: t("description"),
    alternates: buildAlternates({ pathname: "/", locale, availableLocales: LOCALES }),
  };
}

export default async function Home({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}) {
  const { locale } = await params;

  return (
    <>
      <Hero locale={locale} />
      <Stack locale={locale} />
      <Features locale={locale} />
      <CallToAction />
      <FAQ locale={locale} />
    </>
  );
}
