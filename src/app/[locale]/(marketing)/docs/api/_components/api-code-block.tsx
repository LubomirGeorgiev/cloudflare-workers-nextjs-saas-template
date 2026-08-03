import type { ReactNode } from "react";

import { CopyToClipboardButton } from "@/components/copy-to-clipboard-button";

// Chrome shared by the request snippet and the example payloads: a labelled frame with a copy
// button. The body is server-rendered; only the copy button is a client island.
export function ApiCodeBlock({
  label,
  copyValue,
  copyLabel,
  children,
}: {
  label: string;
  copyValue: string;
  copyLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-muted/30">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-muted/40 py-1 pl-4 pr-1">
        <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </span>
        <CopyToClipboardButton value={copyValue} label={copyLabel} />
      </div>
      {children}
    </div>
  );
}
