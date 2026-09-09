"use client";

import { ChevronRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { ApiScopeGrid } from "@/components/api-scope-grid";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { summarizeApiScopes } from "@/lib/api/scope-summary";
import { cn } from "@/lib/utils";

// The collapsed reading of a grant: one sentence saying how far the credential reaches, with the
// full per-scope grid a click away. Ten described scopes per credential is what made the list
// unreadable, and the sentence answers the question a person actually scans for.
export function ApiScopeDisclosure({
  scopes,
  teamId,
  className,
}: {
  scopes: string[];
  /** The credential's audience; "full access" is measured against what that audience may hold. */
  teamId?: string | null;
  className?: string;
}) {
  const t = useTranslations("Client.ApiScopeSummary");
  const format = useFormatter();
  const summary = summarizeApiScopes({ scopes, teamId });

  // A fork's scope names a resource the catalog does not know; the raw prefix still reads.
  function resourceName(resource: string): string {
    const key = `resources.${resource}` as Parameters<typeof t>[0];

    return t.has(key) ? t(key) : resource;
  }

  function headlineFor(): string {
    if (summary.isFullAccess) {
      return t("fullAccess");
    }

    // No resource left means the grant reaches nothing this credential's audience may use, so the
    // "Access to {resources}" sentence would name an empty list.
    if (summary.resources.length === 0) {
      return t("noAccess");
    }

    const resources = format.list(summary.resources.map(resourceName));

    return t(summary.isReadOnly ? "readOnlyAccess" : "partialAccess", { resources });
  }

  const headline = headlineFor();

  return (
    <Collapsible className={cn("group/scopes", className)}>
      <CollapsibleTrigger className="-ml-1 flex max-w-full items-center gap-x-2 gap-y-0.5 rounded-md py-1 pl-1 pr-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-open/scopes:rotate-90 motion-reduce:transition-none"
        />
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-medium">{headline}</span>
          <span className="text-xs text-muted-foreground">
            {t("scopeCount", { count: summary.scopeCount })}
          </span>
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ApiScopeGrid scopes={scopes} className="mt-3 pl-6" />
      </CollapsibleContent>
    </Collapsible>
  );
}
