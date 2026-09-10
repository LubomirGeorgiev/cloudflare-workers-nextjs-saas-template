"use client";

import type { ReactNode } from "react";

import { ApiScopeDisclosure } from "@/components/api-scope-disclosure";
import { cn } from "@/lib/utils";

/**
 * The shared reading of a credential, used by every surface that lists one: account settings, the
 * connected-apps list, and the admin panel's key and grant listings.
 *
 * One ledger, not a stack of cards: a credential is a row, and the rows share one border so the eye
 * reads the list as an inventory rather than as separate panels competing for weight. The row is
 * deliberately presentational — what a credential *is* differs per surface, but how it reads should
 * not, and revoking one is the caller's operation because each surface authorizes it differently.
 */

export function CredentialLedger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <ul className={cn("divide-y rounded-lg border bg-card text-card-foreground", className)}>
      {children}
    </ul>
  );
}

interface CredentialRowProps {
  title: ReactNode;
  /** The chip beside the name: a masked key hint, or a verified badge on a grant. */
  titleBadge?: ReactNode;
  /** The muted line under the name. Empty entries are dropped, so a caller can pass a condition. */
  facts?: ReactNode[];
  /** Revoke, edit scopes, and anything else this surface allows. */
  actions?: ReactNode;
  scopes: string[];
  /** The credential's audience, so "full access" is measured against what that audience may hold. */
  scopeTeamId?: string | null;
  /** Copy for scopes outside the public catalog; the internal catalog is `server-only`. */
  scopeDescriptions?: Record<string, string>;
}

export function CredentialRow({
  title,
  titleBadge,
  facts,
  actions,
  scopes,
  scopeTeamId,
  scopeDescriptions,
}: CredentialRowProps) {
  const shownFacts = (facts ?? []).filter(Boolean);

  return (
    <li className="space-y-3 p-5 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="truncate font-semibold leading-tight">{title}</h3>
            {titleBadge}
          </div>
          {shownFacts.length > 0 ? (
            // A fact can be a Badge or another block element, which a <p> would not hold.
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {shownFacts.map((fact, index) => (
                // Facts are a fixed list per surface, so the index is stable across renders.
                // oxlint-disable-next-line no-array-index-key
                <span key={index}>{fact}</span>
              ))}
            </div>
          ) : null}
        </div>

        {/* Quiet by default: only the row's own name and reach should carry weight. */}
        {actions ? (
          <div className="-ml-3 flex shrink-0 gap-1 sm:-mr-2 sm:-mt-1 sm:ml-0">{actions}</div>
        ) : null}
      </div>

      <ApiScopeDisclosure
        scopes={scopes}
        teamId={scopeTeamId}
        descriptions={scopeDescriptions}
      />
    </li>
  );
}
