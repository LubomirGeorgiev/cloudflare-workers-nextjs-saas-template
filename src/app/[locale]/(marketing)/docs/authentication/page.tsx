import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { DocsProsePage } from "@/app/[locale]/(marketing)/docs/_components/docs-prose-section";
import { API_AUTH_DOCS_PATH, API_DOCS_PATH, MCP_DOCS_PATH } from "@/constants";
import { API_SCOPES, type ApiScope } from "@/lib/api/scopes";
import { LOCALES, type Locale } from "@/i18n/config";
import { buildAlternates } from "@/utils/i18n-metadata";
import { RATE_LIMITS, rateLimitDocsValues } from "@/utils/with-rate-limit";
import { DocsCrossLinks } from "../_components/docs-cross-links";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: Locale }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Client.Docs.Auth.meta" });

  return {
    title: t("title"),
    description: t("description"),
    alternates: buildAlternates({ pathname: API_AUTH_DOCS_PATH, locale, availableLocales: LOCALES }),
  };
}

// Scope names come from the catalog so this page can never drift from the consent screen or the
// OpenAPI document; the descriptions reuse the settings catalog, with the same fallback the
// create-key dialog uses for scopes a fork added without translating them.
async function ScopeTable({ caption }: { caption: string }) {
  const tScopes = await getTranslations("Client.ApiScopes");
  const scopes = Object.keys(API_SCOPES) as ApiScope[];

  function describe(scope: ApiScope): string {
    return tScopes.has(scope) ? tScopes(scope) : API_SCOPES[scope].description;
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <tbody>
          {scopes.map((scope) => (
            <tr key={scope} className="border-b last:border-b-0">
              <td className="whitespace-nowrap px-3 py-2 align-top font-mono text-xs">{scope}</td>
              <td className="px-3 py-2 text-muted-foreground">{describe(scope)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AuthenticationDocsPage() {
  const t = await getTranslations("Client.Docs.Auth");

  return (
    <DocsProsePage
      title={t("title")}
      description={t("description")}
      headerAside={
        <DocsCrossLinks
          links={[
            { href: API_DOCS_PATH, label: t("apiReferenceLink") },
            { href: MCP_DOCS_PATH, label: t("mcpLink") },
          ]}
        />
      }
      sections={[
        { id: "api-keys", title: t("keysTitle"), body: t("keysBody") },
        { id: "team-keys", title: t("teamKeysTitle"), body: t("teamKeysBody") },
        { id: "oauth", title: t("oauthTitle"), body: t("oauthBody") },
        {
          id: "scopes",
          title: t("scopesTitle"),
          body: t("scopesBody"),
          children: <ScopeTable caption={t("scopesTitle")} />,
        },
        { id: "revocation", title: t("revocationTitle"), body: t("revocationBody") },
        {
          id: "rate-limits",
          title: t("limitsTitle"),
          body: t("limitsBody", rateLimitDocsValues(RATE_LIMITS.API_AUTHED)),
        },
      ]}
    />
  );
}
