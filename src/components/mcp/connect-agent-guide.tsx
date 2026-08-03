"use client";

import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";

import { CopyToClipboardButton } from "@/components/copy-to-clipboard-button";
import { HighlightedCode } from "@/components/highlighted-code";
import { AgentClientLogo } from "@/components/mcp/agent-client-logo";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  API_KEY_PLACEHOLDER,
  getAgentClientSnippet,
  getAgentClientsForFlavor,
  getMcpEndpointUrl,
  renderAgentClientSnippet,
  type AgentClient,
  type AgentClientAuthFlavor,
  type AgentClientSnippet,
  type AgentClientSnippetFormat,
} from "@/constants/agent-clients";

// Renders the agent-client registry: one endpoint URL, two auth flavors, one snippet per client.
// The snippets themselves are code and stay untranslated; only the chrome around them is localized.

const AUTH_FLAVORS: AgentClientAuthFlavor[] = ["oauth", "api-key"];

/** Formats with no entry render as plain text: a bare URL has nothing to highlight, and the
 * shared lowlight instance carries no toml grammar. */
const SNIPPET_LANGUAGES: Partial<Record<AgentClientSnippetFormat, string>> = {
  command: "bash",
  json: "json",
};

function SnippetInstruction({ snippet }: { snippet: AgentClientSnippet }) {
  const t = useTranslations("Client.Mcp");

  if (snippet.format === "url") {
    return <>{t("pasteUrl")}</>;
  }
  if (snippet.format === "command") {
    return <>{t("runCommand")}</>;
  }

  return (
    <>
      {t.rich("addToFile", {
        file: snippet.file ?? "",
        code: (chunks) => (
          <code className="break-all font-mono font-medium text-foreground">{chunks}</code>
        ),
      })}
    </>
  );
}

function AgentClientCard({
  client,
  authFlavor,
  apiKey,
  mcpUrl,
}: {
  client: AgentClient;
  authFlavor: AgentClientAuthFlavor;
  apiKey?: string;
  mcpUrl: string;
}) {
  const t = useTranslations("Client.Mcp");
  const snippet = getAgentClientSnippet({ client, authFlavor });

  if (!snippet) {
    return null;
  }

  const rendered = renderAgentClientSnippet({ snippet, apiKey, mcpUrl });

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <AgentClientLogo client={client} />
        <span className="text-sm font-medium">{client.name}</span>
        <Badge variant="outline" className="font-mono text-[10px]">
          {client.transport}
        </Badge>
        <a
          href={client.docsUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-4"
        >
          {t("clientDocs")}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <p className="text-xs text-muted-foreground">
        <SnippetInstruction snippet={snippet} />
      </p>

      <div className="flex items-start gap-2 rounded-md bg-muted/50 p-2">
        <pre className="min-w-0 flex-1 overflow-x-auto text-xs">
          <HighlightedCode
            code={rendered}
            language={SNIPPET_LANGUAGES[snippet.format]}
            className="font-mono"
          />
        </pre>
        <CopyToClipboardButton value={rendered} label={t("copySnippet")} />
      </div>
    </div>
  );
}

export function ConnectAgentGuide({
  apiKey,
  defaultAuthFlavor = "oauth",
}: {
  /** The freshly created secret, interpolated client-side only while it is still on screen. */
  apiKey?: string;
  defaultAuthFlavor?: AgentClientAuthFlavor;
}) {
  const t = useTranslations("Client.Mcp");
  const mcpUrl = getMcpEndpointUrl();

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("endpointLabel")}
        </p>
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
          <code className="min-w-0 flex-1 break-all font-mono text-xs">{mcpUrl}</code>
          <CopyToClipboardButton value={mcpUrl} label={t("copySnippet")} />
        </div>
        <p className="text-xs text-muted-foreground">{t("endpointHint")}</p>
      </div>

      <Tabs defaultValue={defaultAuthFlavor}>
        <TabsList>
          <TabsTrigger value="oauth">{t("oauthTab")}</TabsTrigger>
          <TabsTrigger value="api-key">{t("apiKeyTab")}</TabsTrigger>
        </TabsList>

        {AUTH_FLAVORS.map((authFlavor) => (
          <TabsContent key={authFlavor} value={authFlavor} className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {authFlavor === "oauth" ? t("oauthHint") : t("apiKeyHint")}
            </p>

            {authFlavor === "api-key" ? (
              <p className="text-xs text-muted-foreground">
                {apiKey ? t("freshKeyNote") : t("placeholderNote", { placeholder: API_KEY_PLACEHOLDER })}
              </p>
            ) : null}

            {getAgentClientsForFlavor(authFlavor).map((client) => (
              <AgentClientCard
                key={client.id}
                client={client}
                authFlavor={authFlavor}
                apiKey={apiKey}
                mcpUrl={mcpUrl}
              />
            ))}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
