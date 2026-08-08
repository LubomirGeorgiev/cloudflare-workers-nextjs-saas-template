"use client";

import { useTranslations } from "next-intl";

import { API_SCOPES, API_SCOPE_NAMES, isApiScope } from "@/lib/api/scopes";
import { cn } from "@/lib/utils";

// One rendering of "what this credential may do", shared by the API key list and the connected-apps
// list so a scope reads the same wherever it is granted. Bare pills say nothing to anyone who has
// not memorised the catalog, so every scope carries its description.

// Scopes read `resource:action`; brightening the action is what a user scans for when deciding
// whether a grant is safe. Unknown shapes (no colon) render whole.
function ScopeToken({ scope }: { scope: string }) {
  const separator = scope.lastIndexOf(":");

  return (
    <span className="font-mono text-[11px] leading-none text-muted-foreground/70">
      {separator === -1 ? scope : scope.slice(0, separator + 1)}
      {separator === -1 ? null : (
        <span className="font-medium text-foreground/70">{scope.slice(separator + 1)}</span>
      )}
    </span>
  );
}

/** Catalog order, so the same set of scopes always reads in the same order across credentials. */
function sortByCatalogOrder(scopes: string[]): string[] {
  return [...scopes].sort((a, b) => {
    const indexA = isApiScope(a) ? API_SCOPE_NAMES.indexOf(a) : API_SCOPE_NAMES.length;
    const indexB = isApiScope(b) ? API_SCOPE_NAMES.indexOf(b) : API_SCOPE_NAMES.length;

    return indexA === indexB ? a.localeCompare(b) : indexA - indexB;
  });
}

export function ApiScopeGrid({ scopes, className }: { scopes: string[]; className?: string }) {
  const tScopes = useTranslations("Client.ApiScopes");

  // A credential can outlive the scope it was issued with (a fork may drop one), so an unknown name
  // still renders — as itself — rather than blowing up the page.
  function describeScope(scope: string): string {
    if (!isApiScope(scope)) {
      return scope;
    }

    return tScopes.has(scope) ? tScopes(scope) : API_SCOPES[scope].description;
  }

  return (
    <ul className={cn("grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-3", className)}>
      {sortByCatalogOrder(scopes).map((scope) => (
        <li key={scope} className="flex flex-col gap-1">
          <ScopeToken scope={scope} />
          <span className="text-sm leading-snug">{describeScope(scope)}</span>
        </li>
      ))}
    </ul>
  );
}
