"use client";

import { useState } from "react";
import { Bot, Check, Copy, Download, ExternalLink, MoreHorizontal } from "lucide-react";

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
  const [copied, setCopied] = useState(false);

  return (
    <ButtonGroup>
      <Button
        type="button"
        variant="outline"
        onClick={async () => {
          await navigator.clipboard.writeText(markdown);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
        {copied ? "Copied" : "Copy Markdown"}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="icon" aria-label="More options">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <a target="_blank" rel="noreferrer" href={rawMarkdownUrl}>
                <ExternalLink className="h-4 w-4" />
                Open raw
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a target="_blank" rel="noreferrer" href={DOCS_LLMS_TXT_PATH}>
                <Bot className="h-4 w-4" />
                llms.txt
              </a>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href={downloadUrl}>
                <Download className="h-4 w-4" />
                Download
              </a>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  );
}
