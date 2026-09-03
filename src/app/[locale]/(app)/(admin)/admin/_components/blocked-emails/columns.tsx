"use client"

import type { ColumnDef } from "@tanstack/react-table"
import type { InferSafeActionFnResult } from "next-safe-action"

import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ADMIN_USERS_PATH } from "@/constants"
import { Link } from "@/i18n/navigation"
import { BLOCKED_EMAIL_KINDS } from "@/utils/email-pattern"
import type { getBlockedEmailsAction } from "../../_actions/get-blocked-emails.action"
import { RelativeDateCell } from "../relative-date-cell"

// Derive the row model from the action's return DTO so the table stays in sync.
export type BlockedEmailRow =
  NonNullable<InferSafeActionFnResult<typeof getBlockedEmailsAction>["data"]>["entries"][number]

/** Returns the action promise so the confirm dialog can show progress until the delete settles. */
type DeleteBlockedEmailHandler = (entry: BlockedEmailRow) => void | Promise<unknown>

/** What each stored kind means in one phrase, so the table explains itself without a legend. */
const KIND_LABEL: Record<BlockedEmailRow["kind"], string> = {
  [BLOCKED_EMAIL_KINDS.EMAIL]: "One address",
  [BLOCKED_EMAIL_KINDS.DOMAIN]: "Whole domain",
  [BLOCKED_EMAIL_KINDS.DOMAIN_SUFFIX]: "Domain and subdomains",
}

function DeleteBlockedEmailCell({
  entry,
  onDelete,
}: {
  entry: BlockedEmailRow
  onDelete: DeleteBlockedEmailHandler
}) {
  return (
    <ConfirmDestructiveDialog
      trigger={<Button size="sm" variant="destructive" />}
      triggerLabel="Remove"
      title="Remove this blocklist entry?"
      description={
        <>
          <code>{entry.pattern}</code> will be able to register again. Accounts that already exist
          are unaffected either way — a blocklist entry never banned them.
        </>
      }
      confirmLabel="Remove"
      pendingLabel="Removing..."
      onConfirm={() => onDelete(entry)}
    />
  )
}

export const BLOCKED_EMAIL_TABLE_UNCLICKABLE_COLUMNS = ["actions"]

// The delete handler is owned by the table: the rows live in its `useAction` state, so only the
// table can re-fetch them once an entry is gone.
export function createBlockedEmailColumns({
  onDelete,
}: {
  onDelete: DeleteBlockedEmailHandler
}): ColumnDef<BlockedEmailRow>[] {
  return [
    {
      accessorKey: "pattern",
      header: "Pattern",
      cell: ({ row }) => <code className="font-mono text-sm">{row.original.pattern}</code>,
    },
    {
      accessorKey: "kind",
      header: "Matches",
      cell: ({ row }) => <Badge variant="secondary">{KIND_LABEL[row.original.kind]}</Badge>,
    },
    {
      accessorKey: "reason",
      header: "Reason",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.reason || "—"}</span>
      ),
    },
    {
      accessorKey: "createdByUserId",
      header: "Added by",
      cell: ({ row }) => {
        const userId = row.original.createdByUserId

        if (!userId) {
          return <span className="text-muted-foreground">—</span>
        }

        return (
          <Link href={`${ADMIN_USERS_PATH}/${userId}`} className="font-mono text-xs underline">
            {userId}
          </Link>
        )
      },
    },
    {
      accessorKey: "createdAt",
      header: "Added",
      cell: ({ row }) => <RelativeDateCell value={row.getValue("createdAt") as Date} />,
    },
    {
      id: "actions",
      cell: ({ row }) => <DeleteBlockedEmailCell entry={row.original} onDelete={onDelete} />,
    },
  ]
}
