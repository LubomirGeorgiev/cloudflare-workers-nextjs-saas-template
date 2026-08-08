"use client";

import { ExternalLink, Terminal } from "lucide-react";
import { useTranslations } from "next-intl";

import { CopyToClipboardButton } from "@/components/copy-to-clipboard-button";
import { HighlightedCode } from "@/components/highlighted-code";
import {
  API_DOCS_PATH,
  API_OPENAPI_SPEC_PATH,
  API_V1_BASE_PATH,
  SITE_URL,
} from "@/constants";
import { API_KEY_PLACEHOLDER } from "@/constants/agent-clients";
// The reference lives under `app/[locale]`, so it needs the locale-prefixing Link.
import { Link } from "@/i18n/navigation";

// A key is a bearer token for the REST API as much as it is MCP credentials, so wherever we hand
// one out we show both. The account endpoint is the cheapest operation that proves the key works.
const QUICKSTART_PATH = "/me";

function buildCurlSnippet(apiKey: string): string {
  return `curl ${SITE_URL}${API_V1_BASE_PATH}${QUICKSTART_PATH} \\\n  -H "Authorization: Bearer ${apiKey}"`;
}

export function RestApiQuickstart({ apiKey }: { apiKey?: string }) {
  const t = useTranslations("Client.RestApi");
  const snippet = buildCurlSnippet(apiKey ?? API_KEY_PLACEHOLDER);
  const baseUrl = `${SITE_URL}${API_V1_BASE_PATH}`;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          {t("title")}
        </p>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("baseUrlLabel")}
        </p>
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
          <code className="min-w-0 flex-1 break-all font-mono text-xs">{baseUrl}</code>
          <CopyToClipboardButton value={baseUrl} label={t("copySnippet")} />
        </div>
      </div>

      <div className="space-y-2 rounded-md border p-3">
        <p className="text-xs text-muted-foreground">
          {apiKey
            ? t("snippetHint")
            : t("placeholderNote", { placeholder: API_KEY_PLACEHOLDER })}
        </p>
        <div className="flex items-start gap-2 rounded-md bg-muted/50 p-2">
          <pre className="min-w-0 flex-1 overflow-x-auto text-xs">
            <HighlightedCode code={snippet} language="bash" className="font-mono" />
          </pre>
          <CopyToClipboardButton value={snippet} label={t("copySnippet")} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <Link
          href={API_DOCS_PATH}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 underline underline-offset-4"
        >
          {t("referenceLink")}
          <ExternalLink className="h-3 w-3" />
        </Link>
        <a
          href={API_OPENAPI_SPEC_PATH}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-4"
        >
          {t("specLink")}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
