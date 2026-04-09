"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { Bot } from "lucide-react";

import { DOCS_LLMS_TXT_PATH } from "@/lib/cms/docs-config";
import { cn } from "@/lib/utils";

export function DocsLlmsTxtLink({ className }: { className?: string }) {
  const pathname = usePathname();
  const isActive = pathname === DOCS_LLMS_TXT_PATH;

  return (
    <Link
      href={DOCS_LLMS_TXT_PATH as Route}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-muted/70",
        isActive && "bg-accent font-medium text-accent-foreground",
        className
      )}
      style={{ paddingLeft: 12 }}
    >
      <Bot className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="truncate">llms.txt</span>
    </Link>
  );
}
