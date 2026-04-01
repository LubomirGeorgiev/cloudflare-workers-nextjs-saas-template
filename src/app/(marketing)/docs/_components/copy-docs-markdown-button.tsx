"use client";

import { useState } from "react";
import { Check, Copy, Download, MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface CopyDocsMarkdownButtonProps {
  markdown: string;
  downloadUrl: string;
}

export function CopyDocsMarkdownButton({
  markdown,
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
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <a target="_blank" href={downloadUrl}>
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
