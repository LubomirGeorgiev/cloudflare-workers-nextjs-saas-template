"use client";

import { useAction } from "next-safe-action/hooks";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { revokeAdminOAuthGrantAction } from "../../_actions/admin-api-key-actions";
import { ApiScopeGrid } from "@/components/api-scope-grid";
import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Agent clients that hold an internal scope through OAuth, as opposed to an API key. A separate
// card because they are a separate store — a key is a row in `api_key`, a grant is provider state
// in KV — and because revoking one is a different operation with a different blast radius.

interface AdminOAuthGrantRow {
  grantId: string;
  name: string;
  clientId: string;
  isVerified: boolean;
  scopes: string[];
  grantedAt: string | null;
}

export function AdminOAuthGrantsCard({
  grants,
  scopeDescriptions,
}: {
  grants: AdminOAuthGrantRow[];
  /** Internal scope copy, resolved on the server; the catalog is `server-only`. */
  scopeDescriptions: Record<string, string>;
}) {
  const router = useRouter();

  const { execute: revoke } = useAction(revokeAdminOAuthGrantAction, {
    onError: ({ error }) => {
      toast.dismiss();
      toast.error(error.serverError?.message || "Could not revoke this app.");
    },
    onSuccess: () => {
      toast.dismiss();
      toast.success("Access revoked.");
      router.refresh();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agent apps with internal access</CardTitle>
        <CardDescription>
          Apps you signed in through the consent screen that hold an <code>admin:*</code> scope.
          They also appear under Settings &rarr; API &amp; MCP with your ordinary connections; this
          card is the one that shows only the administrative ones. To see another user&apos;s, open
          them from the Users page.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {grants.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No agent app holds an internal scope. Signing one in through the consent screen puts it
            here.
          </p>
        ) : (
          <ul className="divide-y">
            {grants.map((grant) => (
              <li key={grant.grantId} className="space-y-3 py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium">{grant.name}</p>
                      <Badge variant={grant.isVerified ? "default" : "secondary"}>
                        {grant.isVerified ? "Verified" : "Unverified"}
                      </Badge>
                    </div>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {grant.clientId}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {grant.grantedAt ? `Approved ${grant.grantedAt}` : "Approval date unknown"}
                    </p>
                  </div>
                  <ConfirmDestructiveDialog
                    trigger={
                      <Button size="sm" variant="destructive" className="w-full sm:w-auto" />
                    }
                    triggerLabel="Revoke"
                    pendingLabel="Revoking…"
                    title="Revoke this app's access?"
                    description="Its tokens stop working immediately and it will have to sign in again. This cannot be undone."
                    confirmLabel="Revoke"
                    onConfirm={() => revoke({ grantId: grant.grantId })}
                  />
                </div>
                <ApiScopeGrid scopes={grant.scopes} descriptions={scopeDescriptions} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
