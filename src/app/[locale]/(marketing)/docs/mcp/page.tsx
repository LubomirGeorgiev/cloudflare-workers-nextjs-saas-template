import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { DocsProsePage } from "@/app/[locale]/(marketing)/docs/_components/docs-prose-section";
import { ConnectAgentGuide } from "@/components/mcp/connect-agent-guide";
import { API_AUTH_DOCS_PATH, API_DOCS_PATH, MCP_DOCS_PATH } from "@/constants";
import { LOCALES, type Locale } from "@/i18n/config";
import { buildAlternates } from "@/utils/i18n-metadata";
import { DocsCrossLinks } from "../_components/docs-cross-links";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Client.Docs.Mcp.meta" });

  return {
    title: t("title"),
    description: t("description"),
    alternates: buildAlternates({ pathname: MCP_DOCS_PATH, locale, availableLocales: LOCALES }),
  };
}

export default async function McpDocsPage() {
  const t = await getTranslations("Client.Docs.Mcp");

  return (
    <DocsProsePage
      title={t("title")}
      description={t("description")}
      headerAside={
        <DocsCrossLinks
          links={[
            { href: API_DOCS_PATH, label: t("apiReferenceLink") },
            { href: API_AUTH_DOCS_PATH, label: t("authLink") },
          ]}
        />
      }
      sections={[
        { id: "oauth", title: t("oauthTitle"), body: t("oauthBody") },
        { id: "api-keys", title: t("apiKeyTitle"), body: t("apiKeyBody") },
        { id: "clients", title: t("clientsTitle"), children: <ConnectAgentGuide /> },
        { id: "tools", title: t("toolsTitle"), body: t("toolsBody") },
      ]}
    />
  );
}
