"use client"

import { useCallback, useEffect, useMemo } from "react"
import { useAction } from "next-safe-action/hooks"
import { toast } from "sonner"

import { DataTable } from "@/components/data-table"
import { ADMIN_TABLE_PAGE_SIZE_OPTIONS } from "@/constants"
import { deleteBlockedEmailAction } from "../../_actions/blocked-email-actions"
import { getBlockedEmailsAction } from "../../_actions/get-blocked-emails.action"
import { AdminTableShell } from "../admin-table-shell"
import { useAdminTablePagination } from "../use-admin-table-pagination"
import { AddBlockedEmailDialog } from "./add-blocked-email-dialog"
import {
  BLOCKED_EMAIL_TABLE_UNCLICKABLE_COLUMNS,
  createBlockedEmailColumns,
  type BlockedEmailRow,
} from "./columns"

export function BlockedEmailsTable() {
  const { page, pageSize, pageIndex, onPageChange, onPageSizeChange } = useAdminTablePagination()

  const { execute: fetchEntries, result, status } = useAction(getBlockedEmailsAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Failed to fetch the blocklist")
    },
  })
  const data = result.data
  const error = result.serverError

  const reload = useCallback(() => {
    fetchEntries({ page, pageSize })
  }, [fetchEntries, page, pageSize])

  useEffect(() => {
    reload()
  }, [reload])

  const { executeAsync: deleteEntry } = useAction(deleteBlockedEmailAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Could not remove the entry.")
    },
    onSuccess: () => {
      toast.success("Blocklist entry removed.")
      reload()
    },
  })

  const columns = useMemo(
    () =>
      createBlockedEmailColumns({
        onDelete: (entry: BlockedEmailRow) => deleteEntry({ id: entry.id }),
      }),
    [deleteEntry],
  )

  return (
    <AdminTableShell
      header={
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold">Blocked emails</h1>
            <p className="text-sm text-muted-foreground">
              Patterns that cannot create an account, newest first. An existing account is stopped
              by a ban instead.
            </p>
          </div>
          <AddBlockedEmailDialog onAdded={reload} />
        </div>
      }
      isLoading={status === "executing" || status === "idle"}
      loadingMessage="Loading..."
      errorMessage={error ? `Error: ${error.message}` : undefined}
      emptyMessage="No blocked emails"
      hasData={Boolean(data)}
    >
      {data ? (
        <DataTable
          columns={columns}
          data={data.entries}
          pageCount={data.totalPages}
          pageIndex={pageIndex}
          pageSize={pageSize}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          totalCount={data.totalCount}
          itemNameSingular="pattern"
          itemNamePlural="patterns"
          pageSizeOptions={ADMIN_TABLE_PAGE_SIZE_OPTIONS}
          excludeClickableColumns={BLOCKED_EMAIL_TABLE_UNCLICKABLE_COLUMNS}
        />
      ) : null}
    </AdminTableShell>
  )
}
