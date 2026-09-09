"use client";

import { useTranslations } from "next-intl";

import {
  API_SCOPES,
  apiScopeAction,
  apiScopeResource,
  compareByCatalogOrder,
  isApiScope,
} from "@/lib/api/scopes";
import { cn } from "@/lib/utils";

// One rendering of "what this credential may do", shared by the API key list and the connected-apps
// list so a scope reads the same wherever it is granted. Bare pills say nothing to anyone who has
// not memorised the catalog, so every scope carries its description.

// Scopes read `resource:action`; brightening the action is what a user scans for when deciding
// whether a grant is safe. A name with no action (no separator) renders whole.
function ScopeToken({ scope }: { scope: string }) {
  const action = apiScopeAction(scope);
  const hasAction = action !== scope;

  return (
    <span className="font-mono text-[11px] leading-none text-muted-foreground/70">
      {hasAction ? `${apiScopeResource(scope)}:` : scope}
      {hasAction ? <span className="font-medium text-foreground/70">{action}</span> : null}
    </span>
  );
}

export function ApiScopeGrid({
  scopes,
  className,
  descriptions,
}: {
  scopes: string[];
  className?: string;
  /**
   * Copy for scopes outside the public catalog, supplied by the caller. The internal catalog is
   * `server-only`, so an admin surface resolves its descriptions on the server and passes them in
   * rather than this component reaching for them.
   */
  descriptions?: Record<string, string>;
}) {
  const tScopes = useTranslations("Client.ApiScopes");

  // A credential can outlive the scope it was issued with (a fork may drop one), so an unknown name
  // still renders — as itself — rather than blowing up the page.
  function describeScope(scope: string): string {
    if (descriptions?.[scope]) {
      return descriptions[scope];
    }

    if (!isApiScope(scope)) {
      return scope;
    }

    return tScopes.has(scope) ? tScopes(scope) : API_SCOPES[scope].description;
  }

  return (
    <ul className={cn("grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-3", className)}>
      {[...scopes].sort(compareByCatalogOrder).map((scope) => (
        <li key={scope} className="flex flex-col gap-1">
          <ScopeToken scope={scope} />
          <span className="text-sm leading-snug">{describeScope(scope)}</span>
        </li>
      ))}
    </ul>
  );
}
