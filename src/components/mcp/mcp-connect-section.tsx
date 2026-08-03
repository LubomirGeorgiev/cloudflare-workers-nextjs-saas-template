"use client";

import { Bot } from "lucide-react";
import { useTranslations } from "next-intl";

import { ConnectAgentGuide } from "@/components/mcp/connect-agent-guide";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MCP_DOCS_PATH } from "@/constants";
// The docs guide lives under `app/[locale]`, so it needs the locale-prefixing Link.
import { Link } from "@/i18n/navigation";

// The settings-side entry point to the MCP server: same registry the docs render, minus a real
// secret — keys are only ever interpolated in the dialog that just created one.
export function McpConnectSection() {
  const t = useTranslations("Client.Mcp");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="h-4 w-4 text-muted-foreground" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ConnectAgentGuide />
        <p className="text-xs text-muted-foreground">
          {t.rich("docsCrossLink", {
            link: (chunks) => (
              <Link href={MCP_DOCS_PATH} className="underline underline-offset-4">
                {chunks}
              </Link>
            ),
          })}
        </p>
      </CardContent>
    </Card>
  );
}
