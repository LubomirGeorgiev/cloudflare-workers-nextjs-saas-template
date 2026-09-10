"use client";

import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { revokeAdminApiKeyAction } from "../../_actions/admin-api-key-actions";
import {
  CreateAdminApiKeyDialog,
  type AdminApiEndpoints,
} from "./create-admin-api-key-dialog";
import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { CredentialLedger, CredentialRow } from "@/components/credentials/credential-ledger";
import { Button } from "@/components/ui/button";
import type { ScopeOption } from "@/components/api-keys/scope-picker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Staff tooling: literal English copy, per the admin subtree's convention. The controls themselves
// are the shared ones from `src/components/api-keys/`, so an internal key is created and revoked
// through the same UI as any other.
//
// Scope options arrive as props because `@/lib/api/admin-scopes` is `server-only` — importing it
// here would put the internal catalog into a client bundle, which is what this feature prevents.

interface AdminApiKeyRow {
  id: string;
  name: string;
  /** Already joined by `formatApiKeyHint` on the server, so both surfaces mask a key alike. */
  keyHint: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export function AdminApiKeysPanel({
  scopeOptions,
  endpoints,
  keys,
  scopeDescriptions,
}: {
  scopeOptions: ScopeOption[];
  endpoints: AdminApiEndpoints;
  keys: AdminApiKeyRow[];
  /** Internal scope copy, resolved on the server; the catalog is `server-only`. */
  scopeDescriptions: Record<string, string>;
}) {
  const router = useRouter();

  const { execute: revoke } = useAction(revokeAdminApiKeyAction, {
    onError: ({ error }) => {
      toast.dismiss();
      toast.error(error.serverError?.message || "Could not revoke the key.");
    },
    onSuccess: () => {
      toast.dismiss();
      toast.success("Key revoked.");
      router.refresh();
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle>Internal keys</CardTitle>
          <CardDescription>
            Keys on your own account that carry an internal scope. They are deliberately absent from
            your account settings and from the public API&apos;s key listing, so this is the only
            place you can see or revoke them. Demoting a user revokes theirs automatically. An agent
            signed in through OAuth is a grant, not a key — those are in the card below.
          </CardDescription>
        </div>
        <CreateAdminApiKeyDialog scopeOptions={scopeOptions} endpoints={endpoints} />
      </CardHeader>
      <CardContent>
        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No internal keys yet.</p>
        ) : (
          <CredentialLedger className="rounded-none border-0 bg-transparent">
            {keys.map((key) => (
              <InternalKeyRow
                key={key.id}
                apiKey={key}
                scopeDescriptions={scopeDescriptions}
                onRevoke={() => revoke({ keyId: key.id })}
              />
            ))}
          </CredentialLedger>
        )}
      </CardContent>
    </Card>
  );
}

function InternalKeyRow({
  apiKey,
  scopeDescriptions,
  onRevoke,
}: {
  apiKey: AdminApiKeyRow;
  scopeDescriptions: Record<string, string>;
  onRevoke: () => void;
}) {
  return (
    <CredentialRow
      title={apiKey.name}
      titleBadge={
        <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
          {apiKey.keyHint}
        </code>
      }
      facts={[
        `Created ${apiKey.createdAt}`,
        apiKey.lastUsedAt ? `Last used ${apiKey.lastUsedAt}` : "Never used",
        apiKey.expiresAt ? `Expires ${apiKey.expiresAt}` : "No expiry",
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
          pendingLabel="Revoking…"
          title="Revoke this internal key?"
          description="Any agent using it stops working immediately. This cannot be undone."
          confirmLabel="Revoke"
          onConfirm={onRevoke}
        />
      }
      scopes={apiKey.scopes}
      scopeDescriptions={scopeDescriptions}
    />
  );
}
