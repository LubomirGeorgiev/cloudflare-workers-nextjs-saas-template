"use client";

import type { ReactNode } from "react";

import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatApiKeyHint } from "@/utils/api-key-format";
import { RelativeDateCell } from "./relative-date-cell";

/** Everything both admin key listings show; each page adds one column of its own on top. */
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

interface AdminApiKeysTableProps<TKey extends AdminApiKeyRow> {
  apiKeys: TKey[];
  /** Header of the one column that differs: the user page shows a team, the team page an owner. */
  subjectHeader: string;
  renderSubject: (apiKey: TKey) => ReactNode;
  /** Return the action's promise so the dialog can show progress. */
  onRevoke: (apiKey: TKey) => Promise<unknown>;
}

// One table for both admin key listings. They differ only in the subject column, which is why it
// is the only copy a caller passes: the key hint, the scope badges, the three dates, and the revoke
// dialog are the same rows of the same data on both pages. Literal English, like the rest of the
// admin subtree.
export function AdminApiKeysTable<TKey extends AdminApiKeyRow>({
  apiKeys,
  subjectHeader,
  renderSubject,
  onRevoke,
}: AdminApiKeysTableProps<TKey>) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Key</TableHead>
          <TableHead>{subjectHeader}</TableHead>
          <TableHead>Scopes</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>Last used</TableHead>
          <TableHead>Expires</TableHead>
          <TableHead className="text-right">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {apiKeys.map((apiKey) => (
          <TableRow key={apiKey.id}>
            <TableCell className="font-medium">{apiKey.name}</TableCell>
            <TableCell>
              <Badge variant="outline" className="font-mono text-xs">
                {formatApiKeyHint({ keyPrefix: apiKey.keyPrefix, last4: apiKey.last4 })}
              </Badge>
            </TableCell>
            <TableCell>{renderSubject(apiKey)}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {apiKey.scopes.map((scope) => (
                  <Badge key={scope} variant="outline" className="font-mono text-xs">
                    {scope}
                  </Badge>
                ))}
              </div>
            </TableCell>
            <TableCell><RelativeDateCell value={apiKey.createdAt} /></TableCell>
            <TableCell>
              <RelativeDateCell value={apiKey.lastUsedAt} emptyLabel="Never" />
            </TableCell>
            <TableCell>
              <RelativeDateCell value={apiKey.expiresAt} emptyLabel="Never" />
            </TableCell>
            <TableCell className="text-right">
              <ConfirmDestructiveDialog
                trigger={<Button size="sm" variant="destructive" />}
                triggerLabel="Revoke"
                title="Revoke API key"
                description={`${apiKey.name} stops working and cannot be restored. Anything using it has to be issued a new key.`}
                confirmLabel="Revoke"
                pendingLabel="Revoking..."
                onConfirm={() => onRevoke(apiKey)}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
