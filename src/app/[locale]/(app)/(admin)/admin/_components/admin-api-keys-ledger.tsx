"use client";

import type { ReactNode } from "react";

import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { CredentialLedger, CredentialRow } from "@/components/credentials/credential-ledger";
import { Button } from "@/components/ui/button";
import { formatApiKeyHint } from "@/utils/api-key-format";
import { RelativeDateCell } from "./relative-date-cell";

// One listing for both admin key pages, and the same reading a user gets in their own settings:
// the shared ledger row, with this surface's own revoke. They differ only in the subject fact — the
// user page names a team, the team page an owner — which is why that is the only copy a caller
// passes. Literal English, like the rest of the admin subtree.

/** Everything both admin key listings hold; each page adds one fact of its own on top. */
interface AdminApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  last4: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
}

export function AdminApiKeysLedger<TKey extends AdminApiKeyRow>({
  apiKeys,
  renderSubject,
  scopeTeamIdOf,
  onRevoke,
}: {
  apiKeys: TKey[];
  renderSubject: (apiKey: TKey) => ReactNode;
  /** The key's audience, so the scope summary measures "full access" against the right ceiling. */
  scopeTeamIdOf?: (apiKey: TKey) => string | null;
  /** Return the action's promise so the dialog can show progress. */
  onRevoke: (apiKey: TKey) => Promise<unknown>;
}) {
  return (
    <CredentialLedger>
      {apiKeys.map((apiKey) => (
        <CredentialRow
          key={apiKey.id}
          title={apiKey.name}
          titleBadge={
            <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              {formatApiKeyHint({ keyPrefix: apiKey.keyPrefix, last4: apiKey.last4 })}
            </code>
          }
          facts={[
            renderSubject(apiKey),
            <>Created <RelativeDateCell value={apiKey.createdAt} /></>,
            <>Last used <RelativeDateCell value={apiKey.lastUsedAt} emptyLabel="never" /></>,
            <>Expires <RelativeDateCell value={apiKey.expiresAt} emptyLabel="never" /></>,
          ]}
          actions={
            <ConfirmDestructiveDialog
              trigger={
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                />
              }
              triggerLabel="Revoke"
              title="Revoke API key"
              description={`${apiKey.name} stops working and cannot be restored. Anything using it has to be issued a new key.`}
              confirmLabel="Revoke"
              pendingLabel="Revoking…"
              onConfirm={() => onRevoke(apiKey)}
            />
          }
          scopes={apiKey.scopes}
          scopeTeamId={scopeTeamIdOf?.(apiKey) ?? null}
        />
      ))}
    </CredentialLedger>
  );
}
