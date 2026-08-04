import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { DocsProsePage } from "@/app/[locale]/(marketing)/docs/_components/docs-prose-section";
import { API_DOCS_PATH, API_ERRORS_DOCS_PATH } from "@/constants";
import { PROBLEM_CODES, PROBLEM_BY_CODE, type ProblemCode } from "@/lib/api/errors";
import { FIELD_ERROR_CODES } from "@/lib/api/field-errors";
import { LOCALES, type Locale } from "@/i18n/config";
import { buildAlternates } from "@/utils/i18n-metadata";
import { RATE_LIMITS, rateLimitDocsValues } from "@/utils/with-rate-limit";
import { DocsCrossLinks } from "../../_components/docs-cross-links";

const INTERNAL_ERROR_STATUS = 500;

interface CodeMeaning {
  code: string;
  /** Omitted by the field-error vocabulary, which has no status of its own. */
  status?: number;
  meaning: string;
}

async function CodesTable({ rows, withStatus }: { rows: CodeMeaning[]; withStatus: boolean }) {
  const t = await getTranslations("Client.Docs.ApiErrors");

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="px-3 py-2 font-medium">{t("columnCode")}</th>
            {withStatus ? (
              <th scope="col" className="px-3 py-2 font-medium">{t("columnStatus")}</th>
            ) : null}
            <th scope="col" className="px-3 py-2 font-medium">{t("columnMeaning")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ code, status, meaning }) => (
            // The anchor is the fragment the problem document's `type` member points at.
            <tr key={code} id={code} className="scroll-mt-24 border-b last:border-b-0">
              <td className="whitespace-nowrap px-3 py-2 align-top font-mono text-xs">{code}</td>
              {withStatus ? (
                <td className="px-3 py-2 align-top tabular-nums">{status}</td>
              ) : null}
              <td className="px-3 py-2 text-muted-foreground">{meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Client.Docs.ApiErrors.meta" });

  return {
    title: t("title"),
    description: t("description"),
    alternates: buildAlternates({
      pathname: API_ERRORS_DOCS_PATH,
      locale,
      availableLocales: LOCALES,
    }),
  };
}

export default async function ApiErrorsDocsPage() {
  const t = await getTranslations("Client.Docs.ApiErrors");

  // Derived from the mapper's own registry, so a new code cannot ship undocumented; the literal
  // union still forces a type-checked catalog entry per code, and the status comes from the mapper.
  const problemCodes: CodeMeaning[] = PROBLEM_CODES.map((code: ProblemCode) => ({
    code,
    status: PROBLEM_BY_CODE[code]?.status ?? INTERNAL_ERROR_STATUS,
    meaning: t(`codes.${code}`, rateLimitDocsValues(RATE_LIMITS.API_AUTHED)),
  }));

  // Same discipline for the field-level vocabulary: the published list is the source, so a code
  // added to it without a catalog entry fails the build rather than shipping undocumented.
  const fieldCodes: CodeMeaning[] = FIELD_ERROR_CODES.map((code) => ({
    code,
    meaning: t(`fieldCodes.${code}`),
  }));

  return (
    <DocsProsePage
      title={t("title")}
      description={t("description")}
      headerAside={
        <DocsCrossLinks links={[{ href: API_DOCS_PATH, label: t("apiReferenceLink") }]} />
      }
      sections={[
        { id: "shape", title: t("shapeTitle"), body: t("shapeBody") },
        {
          id: "codes",
          title: t("codesTitle"),
          body: t("codesBody"),
          children: <CodesTable rows={problemCodes} withStatus />,
        },
        {
          id: "fields",
          title: t("fieldsTitle"),
          body: t("fieldsBody"),
          children: <CodesTable rows={fieldCodes} withStatus={false} />,
        },
        { id: "retries", title: t("retryTitle"), body: t("retryBody") },
      ]}
    />
  );
}
