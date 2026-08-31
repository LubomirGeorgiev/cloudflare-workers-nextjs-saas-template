"use client";

import { Bot } from "lucide-react";
import { useTranslations } from "next-intl";

import { ApiKeySecretPanel } from "@/components/api-keys/api-key-secret-panel";
import { RestApiQuickstart } from "@/components/api-keys/rest-api-quickstart";
import { ConnectAgentGuide } from "@/components/mcp/connect-agent-guide";
import { Separator } from "@/components/ui/separator";

/**
 * The settings dialog's second mode: the one and only time a public key's secret is shown, with the
 * quickstart for the public REST API and MCP endpoint beside it.
 */
export function ApiKeySecretReveal({ secret, onDone }: { secret: string; onDone: () => void }) {
  const t = useTranslations("Client.Settings.ApiKeys");
  const tMcp = useTranslations("Client.Mcp");

  return (
    <ApiKeySecretPanel
      secret={secret}
      title={t("secretTitle")}
      description={t("secretDescription")}
      onDone={onDone}
    >
      {/* The only place a real secret is ever interpolated into a snippet. */}
      <RestApiQuickstart apiKey={secret} />
      <Separator />
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Bot className="h-4 w-4 text-muted-foreground" />
          {tMcp("title")}
        </p>
        <ConnectAgentGuide apiKey={secret} defaultAuthFlavor="api-key" />
      </div>
    </ApiKeySecretPanel>
  );
}
