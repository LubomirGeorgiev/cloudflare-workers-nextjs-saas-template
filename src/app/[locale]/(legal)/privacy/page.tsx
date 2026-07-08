import { Metadata } from "next";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { getTranslations } from "next-intl/server";
import { getCloudflareContext } from "@/utils/cloudflare-context";
import { LOCALES, type Locale } from "@/i18n/config";
import { buildAlternates } from "@/utils/i18n-metadata";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Legal.Privacy.meta" });

  return {
    title: t("title"),
    description: t("description"),
    alternates: buildAlternates({ pathname: "/privacy", locale, availableLocales: LOCALES }),
  };
}

const lastUpdated = new Date('2025-01-15T20:10:16.287Z')

export default async function PrivacyPage() {
  const { env } = await getCloudflareContext();
  const t = await getTranslations("Legal.Privacy");

  const email = env?.EMAIL_REPLY_TO

  return (
    <>
      <h1 className="text-4xl font-bold text-foreground mb-8">{t("title")}</h1>

      <p className="text-muted-foreground mb-6">{t("lastUpdated", { date: lastUpdated.toLocaleDateString() })}</p>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-foreground mb-4">{t("informationWeCollect.heading")}</h2>
        <p className="text-muted-foreground">
          {t("informationWeCollect.body")}
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-foreground mb-4">{t("howWeUseInformation.heading")}</h2>
        <p className="text-muted-foreground">
          {t("howWeUseInformation.intro")}
        </p>
        <ul className="list-disc pl-6 mt-2 text-muted-foreground">
          <li>{t("howWeUseInformation.item1")}</li>
          <li>{t("howWeUseInformation.item2")}</li>
          <li>{t("howWeUseInformation.item3")}</li>
          <li>{t("howWeUseInformation.item4")}</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-2xl font-semibold text-foreground mb-4">{t("dataSecurity.heading")}</h2>
        <p className="text-muted-foreground">
          {t("dataSecurity.body")}
        </p>
      </section>

      {email && (
        <section className="mb-8">
          <h2 className="text-2xl font-semibold text-foreground mb-4">{t("contactUs.heading")}</h2>
          <p className="text-muted-foreground">
            {t("contactUs.body")}
            <br />
            {t("contactUs.email", { email })}
          </p>
        </section>
      )}

      <div className="mt-12 text-center">
        <Link href="/" className={buttonVariants()}>
          {t("returnToHome")}
        </Link>
      </div>
    </>
  );
}
