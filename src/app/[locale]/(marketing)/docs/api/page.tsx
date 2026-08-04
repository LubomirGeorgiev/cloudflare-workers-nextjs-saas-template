import type { Metadata } from "next";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { getTranslations } from "next-intl/server";

import { CopyToClipboardButton } from "@/components/copy-to-clipboard-button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { apiDocument } from "@/api/generated-document";
import {
  API_AUTH_DOCS_PATH,
  API_DOCS_PATH,
  API_ERRORS_DOCS_PATH,
  API_OPENAPI_SPEC_PATH,
  MCP_DOCS_PATH,
} from "@/constants";
import { LOCALES, type Locale } from "@/i18n/config";
import { buildApiReferenceView } from "@/lib/api/reference-model";
import { mcpToolNameByOperationId } from "@/mcp/derive-tools";
import { buildAlternates } from "@/utils/i18n-metadata";
import { RATE_LIMITS, rateLimitDocsValues } from "@/utils/with-rate-limit";

import { ApiOperation } from "./_components/api-operation";
import { EMPTY_STATE_ATTRIBUTES, GROUP_FILTER_ATTRIBUTES } from "./_components/api-reference-dom";
import { ApiReferenceFilter } from "./_components/api-reference-filter";
import { ApiReferenceIndex } from "./_components/api-reference-index";
import { DocsCrossLinks } from "../_components/docs-cross-links";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Client.Docs.ApiReference.meta" });

  return {
    title: t("title"),
    description: t("description"),
    alternates: buildAlternates({ pathname: API_DOCS_PATH, locale, availableLocales: LOCALES }),
  };
}

export default async function ApiReferencePage() {
  const t = await getTranslations("Client.Docs.ApiReference");
  const document = apiDocument();
  // The MCP derivation owns which operations become tools and what they are called; the view model
  // only labels them, so the mapping is passed in rather than reached for from the docs layer.
  const view = buildApiReferenceView({
    document,
    mcpToolNames: mcpToolNameByOperationId(document),
  });

  return (
    <NuqsAdapter>
      <div className="px-4 py-10 lg:px-8">
        <header className="mb-8 space-y-4">
          <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="max-w-2xl text-muted-foreground">{t("description")}</p>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t("rateLimit", rateLimitDocsValues(RATE_LIMITS.API_AUTHED))}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 items-center gap-2 rounded-full border border-border/70 bg-muted/30 py-1 pl-3 pr-1">
              <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                {t("baseUrlLabel")}
              </span>
              <code className="min-w-0 truncate font-mono text-xs text-foreground">
                {view.baseUrl}
              </code>
              <CopyToClipboardButton
                value={view.baseUrl}
                label={t("copyBaseUrl")}
                className="h-6 px-1.5"
              />
            </div>

            <span className="rounded-full border border-border/70 bg-muted/30 px-3 py-1 font-mono text-xs text-muted-foreground">
              v{view.version}
            </span>
          </div>

          <DocsCrossLinks
            links={[
              { href: API_OPENAPI_SPEC_PATH, label: t("specLink"), isLocalized: false },
              { href: API_AUTH_DOCS_PATH, label: t("authLink") },
              { href: API_ERRORS_DOCS_PATH, label: t("errorsLink") },
              { href: MCP_DOCS_PATH, label: t("mcpLink") },
            ]}
          />
        </header>

        <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_260px]">
          <div className="min-w-0">
            <div className="sticky top-0 z-10 -mx-4 mb-8 border-b bg-background/95 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:-mx-8 lg:px-8">
              <ApiReferenceFilter methods={view.methods} total={view.operationCount} />
            </div>

            <div className="space-y-10">
              {view.groups.map((group) => (
                <section key={group.name} {...GROUP_FILTER_ATTRIBUTES} className="space-y-4">
                  <h2 className="text-xl font-semibold tracking-tight">{group.name}</h2>

                  <div className="space-y-4">
                    {group.operations.map((operation) => (
                      <ApiOperation key={operation.operationId} operation={operation} />
                    ))}
                  </div>
                </section>
              ))}

              {/* Hidden until the filter finds nothing, so it never shows without JavaScript. */}
              <p
                {...EMPTY_STATE_ATTRIBUTES}
                hidden
                className="rounded-2xl border border-dashed border-border/70 px-5 py-8 text-center text-sm text-muted-foreground"
              >
                {t("noResults")}
              </p>
            </div>
          </div>

          <aside className="hidden xl:block">
            <div className="sticky top-10 flex h-[calc(100vh-5rem)] flex-col">
              <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade-y">
                <div className="pb-10">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    {t("endpointsLabel")}
                  </p>
                  <ApiReferenceIndex view={view} />
                </div>
              </ScrollArea>
            </div>
          </aside>
        </div>
      </div>
    </NuqsAdapter>
  );
}
