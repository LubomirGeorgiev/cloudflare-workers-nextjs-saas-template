"use client";

import { usePathname } from "next/navigation";
import { Bot } from "lucide-react";
import { useTranslations } from "next-intl";

import { DOCS_LLMS_TXT_PATH } from "@/lib/cms/docs-config";
import { cn } from "@/lib/utils";

export function DocsLlmsTxtLink({
  className,
  onNavigate,
}: {
  className?: string;
  onNavigate?: () => void;
}) {
  const t = useTranslations("Client.Docs.Navigation");
  const pathname = usePathname();
  const isActive = pathname === DOCS_LLMS_TXT_PATH;

  // Plain <a>, not the i18n Link: llms.txt is a machine endpoint (a text/plain
  // route handler) served at a single non-localized URL like robots.txt, so it
  // must not gain a locale prefix for non-default locales.
  return (
    <a
      href={DOCS_LLMS_TXT_PATH}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted/70",
        isActive && "bg-accent font-medium text-accent-foreground",
        className
      )}
      style={{ paddingLeft: 12 }}
    >
      <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
      {/* "llms.txt" is a filename/protocol constant, intentionally not localized */}
      <span className="truncate">{t("llmsTxt")}</span>
    </a>
  );
}
