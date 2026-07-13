import { Metadata } from "next";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { LOCALES, type Locale } from "@/i18n/config";
import { buildAlternates } from "@/utils/i18n-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Legal.Terms.meta" });

  return {
    title: t("title"),
    description: t("description"),
    alternates: buildAlternates({ pathname: "/terms", locale, availableLocales: LOCALES }),
  };
}

const lastUpdated = new Date('2025-01-15T20:10:16.287Z')

export default function TermsPage() {
  const t = useTranslations("Legal.Terms");

  return (
    <>
      <h1 className="text-4xl font-bold text-foreground mb-8">{t("title")}</h1>

      <p className="text-muted-foreground mb-6">{t("lastUpdated", { date: lastUpdated.toLocaleDateString() })}</p>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-foreground mb-4">{t("acceptanceOfTerms.heading")}</h2>
        <p className="text-muted-foreground">
          {t("acceptanceOfTerms.body")}
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-foreground mb-4">{t("useLicense.heading")}</h2>
        <p className="text-muted-foreground">
          {t("useLicense.body")}
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-foreground mb-4">{t("disclaimer.heading")}</h2>
        <p className="text-muted-foreground">
          {t("disclaimer.body")}
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-foreground mb-4">{t("subscriptions.heading")}</h2>
        <p className="text-muted-foreground mb-4">
          {t("subscriptions.body1")}
        </p>
        <p className="text-muted-foreground mb-4">
          {t("subscriptions.body2")}
        </p>
        <p className="text-muted-foreground">
          {t("subscriptions.body3")}
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-foreground mb-4">{t("limitations.heading")}</h2>
        <p className="text-muted-foreground">
          {t("limitations.body")}
        </p>
      </section>

      <div className="mt-12 text-center">
        <Link href="/" className={buttonVariants()}>
          {t("returnToHome")}
        </Link>
      </div>
    </>
  );
}
