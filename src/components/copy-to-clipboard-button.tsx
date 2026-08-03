"use client";

import { Check, Copy } from "lucide-react";

import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Icon-only copy affordance for snippets, endpoint URLs, and other one-value blocks. The label is
// only ever an accessible name, so callers pass copy already translated in their own namespace.
export function CopyToClipboardButton({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const { copy, hasCopied } = useCopyToClipboard();

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={() => copy(value)}
      aria-label={label}
      className={cn("shrink-0 text-muted-foreground hover:text-foreground", className)}
    >
      {hasCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}
