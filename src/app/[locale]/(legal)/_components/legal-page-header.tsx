import type { Locale } from "@/i18n/config";
import { buildPageGraph, JsonLd } from "@/lib/seo/json-ld";

export async function LegalPageHeader({
  locale,
  pathname,
  title,
  description,
  lastUpdated,
  lastUpdatedText,
}: LegalPageHeaderProps) {
  // `dateModified` is the one signal that matters on a policy page: it tells a crawler, and a
  // model summarising the terms, which revision it is reading.
  const graph = await buildPageGraph({
    locale,
    pathname,
    name: title,
    description,
    dateModified: lastUpdated,
  });

  return (
    <>
      <JsonLd graph={graph} />
      <h1 className="text-4xl font-bold text-foreground mb-8">{title}</h1>

      <p className="text-muted-foreground mb-6">{lastUpdatedText}</p>
    </>
  );
}

interface LegalPageHeaderProps {
  locale: Locale;
  pathname: string;
  title: string;
  description: string;
  lastUpdated: Date;
  lastUpdatedText: string;
}
