"use client";

import { Bot, Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";

import { RestApiQuickstart } from "@/components/api-keys/rest-api-quickstart";
import { ConnectAgentGuide } from "@/components/mcp/connect-agent-guide";
import { Button } from "@/components/ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";

/**
 * The dialog's second mode: the one and only time a key's secret is shown. It lives in client
 * state and disappears with the dialog, so nothing can render it again.
 */
export function ApiKeySecretReveal({ secret, onDone }: { secret: string; onDone: () => void }) {
  const t = useTranslations("Client.Settings.ApiKeys");
  const tCommon = useTranslations("Client.Common");
  const tMcp = useTranslations("Client.Mcp");
  const { copy, hasCopied } = useCopyToClipboard();

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("secretTitle")}</DialogTitle>
        <DialogDescription>{t("secretDescription")}</DialogDescription>
      </DialogHeader>

      <div className="rounded-md border bg-muted/50 p-3">
        <code className="break-all font-mono text-sm">{secret}</code>
      </div>

      {/* The only place a real secret is ever interpolated into a snippet. */}
      <div className="max-h-[45vh] space-y-6 overflow-y-auto pr-1">
        <RestApiQuickstart apiKey={secret} />
        <Separator />
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Bot className="h-4 w-4 text-muted-foreground" />
            {tMcp("title")}
          </p>
          <ConnectAgentGuide apiKey={secret} defaultAuthFlavor="api-key" />
        </div>
      </div>

      <DialogFooter className="mt-4">
        <Button variant="outline" onClick={() => copy(secret)}>
          {hasCopied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
          {hasCopied ? tCommon("copied") : t("copySecret")}
        </Button>
        <Button onClick={onDone}>{t("secretDone")}</Button>
      </DialogFooter>
    </>
  );
}
