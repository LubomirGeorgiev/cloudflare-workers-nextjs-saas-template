"use client";

import { useState } from "react";
import { Bot, Check, Copy, Download, ExternalLink, MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DOCS_LLMS_TXT_PATH } from "@/lib/cms/docs-config";

interface CopyDocsMarkdownButtonProps {
  markdown: string;
  rawMarkdownUrl: string;
  downloadUrl: string;
}

export function CopyDocsMarkdownButton({
  markdown,
  rawMarkdownUrl,
  downloadUrl,
}: CopyDocsMarkdownButtonProps) {
  const t = useTranslations("Client.Docs.MarkdownButton");
  const [copied, setCopied] = useState(false);

  return (
    <ButtonGroup>
      <Button
        type="button"
        variant="outline"
        className="cursor-pointer"
        onClick={async () => {
          await navigator.clipboard.writeText(markdown);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
        {copied ? t("copied") : t("copyMarkdown")}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("moreOptions")}
            />
          }
        >
            <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuGroup>
            <DropdownMenuItem
              render={<a target="_blank" rel="noreferrer" href={rawMarkdownUrl} />}
            >
                <ExternalLink className="h-4 w-4" />
                {t("openAsMarkdown")}
            </DropdownMenuItem>
            <DropdownMenuItem
              render={<a target="_blank" rel="noreferrer" href={DOCS_LLMS_TXT_PATH} />}
            >
                <Bot className="h-4 w-4" />
                {/* "llms.txt" is a filename/protocol constant, intentionally not localized */}
                {t("llmsTxt")}
            </DropdownMenuItem>
            <DropdownMenuItem render={<a href={downloadUrl} />}>
                <Download className="h-4 w-4" />
                {t("download")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
}
