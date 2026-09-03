import { Metadata } from "next";
import { getTranslator } from "@/i18n/translator";
import { Hero } from "@/components/landing/hero";
import { Stack } from "@/components/landing/stack";
import { Features } from "@/components/landing/features";
import { CallToAction } from "@/components/landing/cta";
import { FAQ } from "@/components/landing/faq";
import { LOCALES, type Locale } from "@/i18n/config";
import { buildAlternates } from "@/utils/i18n-metadata";
import { buildFaqQuestions } from "@/lib/seo/faq-json-ld";
import { buildPageGraph, JsonLd } from "@/lib/seo/json-ld";

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
  const t = await getTranslator({ locale, namespace: "Landing.meta" });

  // The page is typed `FAQPage` as well as `WebPage` because its question list is the one part an
  // answer engine can lift verbatim; the questions are the same ones the accordion renders.
  const graph = await buildPageGraph({
    locale,
    pathname: "/",
    name: t("title"),
    description: t("description"),
    pageTypes: ["FAQPage"],
    mainEntity: await buildFaqQuestions(locale),
  });

  return (
    <>
      <JsonLd graph={graph} />
      <Hero locale={locale} />
      <Stack locale={locale} />
      <Features locale={locale} />
      <CallToAction />
      <FAQ locale={locale} />
    </>
  );
}
