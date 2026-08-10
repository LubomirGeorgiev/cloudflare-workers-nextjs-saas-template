import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { GITHUB_REPO_URL } from "@/constants";
import { getTranslator } from "@/i18n/translator";
import type { Locale } from "@/i18n/config";

type FaqTranslator = Awaited<ReturnType<typeof getTranslator<"Landing.Faq">>>;

const FAQ_KEYS = [
  "isFree",
  "featuresIncluded",
  "techStack",
  "deploy",
  "gettingStarted",
  "roadmap",
  "emailTemplates",
  "customize",
  "contribute",
] as const;

export async function FAQ({ locale }: { locale: Locale }) {
  const t = await getTranslator({ locale, namespace: "Landing.Faq" });

  return (
    <section className="border-t border-border bg-card/40 py-24 sm:py-32">
      <div className="mx-auto grid max-w-7xl gap-12 px-6 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16 lg:px-8">
        <div className="lg:sticky lg:top-24 lg:self-start">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-edge">
            {t("eyebrow")}
          </p>
          <h2 className="mt-4 font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            {t("heading")}
          </h2>
          <p className="mt-5 text-lg leading-8 text-muted-foreground">
            {t("description")}
          </p>
        </div>

        <Accordion type="single" collapsible className="w-full">
          {FAQ_KEYS.map((key, index) => (
            <AccordionItem key={key} value={`item-${index}`} className="border-border">
              <AccordionTrigger className="text-left font-display text-base font-medium">
                {t(`${key}.question`)}
              </AccordionTrigger>
              <AccordionContent>
                <div className="prose prose-sm dark:prose-invert w-full max-w-none text-muted-foreground prose-a:text-edge">
                  <FaqAnswer faqKey={key} t={t} />
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

function FaqAnswer({ faqKey, t }: { faqKey: (typeof FAQ_KEYS)[number]; t: FaqTranslator }) {
  const richLink = {
    link: (chunks: React.ReactNode) => (
      <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer">
        {chunks}
      </a>
    ),
  };
  const richReadme = {
    link: (chunks: React.ReactNode) => (
      <a href={`${GITHUB_REPO_URL}/blob/main/README.md`} target="_blank" rel="noreferrer">
        {chunks}
      </a>
    ),
  };
  const richCode = {
    code: (chunks: React.ReactNode) => <code>{chunks}</code>,
  };

  switch (faqKey) {
    case "isFree":
      return <>{t.rich("isFree.answer", richLink)}</>;
    case "featuresIncluded":
      return (
        <>
          {t("featuresIncluded.intro")}
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>{t("featuresIncluded.item1")}</li>
            <li>{t("featuresIncluded.item2")}</li>
            <li>{t("featuresIncluded.item3")}</li>
            <li>{t("featuresIncluded.item4")}</li>
            <li>{t("featuresIncluded.item5")}</li>
            <li>{t("featuresIncluded.item6")}</li>
            <li>{t("featuresIncluded.item7")}</li>
            <li>{t("featuresIncluded.item8")}</li>
            <li>{t("featuresIncluded.item9")}</li>
            <li>{t("featuresIncluded.item10")}</li>
            <li>{t("featuresIncluded.item11")}</li>
            <li>{t("featuresIncluded.item12")}</li>
          </ul>
        </>
      );
    case "techStack":
      return (
        <>
          <p>{t("techStack.intro")}</p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>{t("techStack.item1")}</li>
            <li>{t("techStack.item2")}</li>
            <li>{t("techStack.item3")}</li>
            <li>{t("techStack.item4")}</li>
            <li>{t("techStack.item5")}</li>
            <li>{t("techStack.item6")}</li>
            <li>{t("techStack.item7")}</li>
            <li>{t("techStack.item8")}</li>
          </ul>
        </>
      );
    case "deploy":
      return (
        <>
          <p>{t("deploy.intro")}</p>
          <ol className="list-decimal pl-6 mt-2 space-y-1">
            <li>{t("deploy.item1")}</li>
            <li>{t("deploy.item2")}</li>
            <li>{t("deploy.item3")}</li>
            <li>{t("deploy.item4")}</li>
            <li>{t("deploy.item5")}</li>
            <li>{t("deploy.item6")}</li>
          </ol>
          <p className="mt-2">{t.rich("deploy.outro", richLink)}</p>
        </>
      );
    case "gettingStarted":
      return (
        <>
          <p>{t("gettingStarted.paragraph1")}</p>
          <p>{t.rich("gettingStarted.paragraph2", richReadme)}</p>
        </>
      );
    case "roadmap":
      return (
        <>
          <p>{t("roadmap.intro")}</p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>{t("roadmap.item1")}</li>
            <li>{t("roadmap.item2")}</li>
            <li>{t("roadmap.item3")}</li>
            <li>{t("roadmap.item4")}</li>
            <li>{t("roadmap.item5")}</li>
            <li>{t("roadmap.item6")}</li>
            <li>{t("roadmap.item7")}</li>
            <li>{t("roadmap.item8")}</li>
            <li>{t("roadmap.item9")}</li>
          </ul>
        </>
      );
    case "emailTemplates":
      return <>{t("emailTemplates.answer")}</>;
    case "customize":
      return (
        <>
          <p>{t("customize.intro")}</p>
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>{t.rich("customize.item1", richCode)}</li>
            <li>{t.rich("customize.item2", richCode)}</li>
            <li>{t.rich("customize.item3", richCode)}</li>
          </ul>
        </>
      );
    case "contribute":
      return <>{t.rich("contribute.answer", richLink)}</>;
    default:
      return null;
  }
}
