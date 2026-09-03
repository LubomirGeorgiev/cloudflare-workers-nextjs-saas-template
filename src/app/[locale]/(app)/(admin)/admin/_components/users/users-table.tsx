"use client"

import { useEffect } from "react"
import { DataTable } from "@/components/data-table"
import { columns, type User } from "./columns"
import { getUsersAction } from "../../_actions/get-users.action"
import { useAction } from "next-safe-action/hooks"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { ADMIN_TABLE_PAGE_SIZE_OPTIONS } from "@/constants"
import { parseAsBoolean, useQueryState } from "nuqs"
import { AdminTableShell } from "../admin-table-shell"
import { useAdminTablePagination } from "../use-admin-table-pagination"

export function UsersTable() {
  const {
    page,
    pageSize,
    pageIndex,
    onPageChange,
    onPageSizeChange,
    resetToFirstPage,
  } = useAdminTablePagination()
  const [emailFilter, setEmailFilter] = useQueryState("email", { defaultValue: "" })
  const [bannedOnly, setBannedOnly] = useQueryState(
    "banned",
    parseAsBoolean.withDefault(false),
  )

  const { execute: fetchUsers, result, status } = useAction(getUsersAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Failed to fetch users")
    },
  })
  const data = result.data
  const error = result.serverError

  useEffect(() => {
    fetchUsers({ page, pageSize, emailFilter, bannedOnly })
  }, [fetchUsers, page, pageSize, emailFilter, bannedOnly])

  const handleEmailFilterChange = (value: string) => {
    setEmailFilter(value)
    resetToFirstPage()
  }

  const handleBannedOnlyChange = (value: boolean) => {
    setBannedOnly(value)
    resetToFirstPage()
  }

  const getRowHref = (user: User) => {
    return `/admin/users/${user.id}`
  }

  return (
    <AdminTableShell
      header={
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-3xl font-bold">Users</h1>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <Checkbox
                id="banned-only"
                checked={bannedOnly}
                onCheckedChange={(checked) => handleBannedOnlyChange(Boolean(checked))}
              />
              <Label htmlFor="banned-only" className="text-sm font-normal">
                Banned only
              </Label>
            </div>
            <Input
              placeholder="Filter emails..."
              type="search"
              value={emailFilter}
              onChange={(event) => handleEmailFilterChange(event.target.value)}
              className="max-w-sm"
            />
          </div>
        </div>
      }
      isLoading={status === 'executing' || status === 'idle'}
      loadingMessage="Loading..."
      errorMessage={error ? `Error: ${error.message}` : undefined}
      emptyMessage="No users found"
      hasData={Boolean(data)}
    >
      {data ? (
        <DataTable
          columns={columns}
          data={data.users}
          pageCount={data.totalPages}
          pageIndex={pageIndex}
          pageSize={pageSize}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          totalCount={data.totalCount}
          itemNameSingular="user"
          itemNamePlural="users"
          pageSizeOptions={ADMIN_TABLE_PAGE_SIZE_OPTIONS}
          getRowHref={getRowHref}
        />
      ) : null}
    </AdminTableShell>
  )
}
