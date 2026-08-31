"use client"

import { useCallback, useEffect } from "react"
import { useAction } from "next-safe-action/hooks"
import { useQueryState } from "nuqs"
import { toast } from "sonner"

import { DataTable } from "@/components/data-table"
import { Input } from "@/components/ui/input"
import { ADMIN_TABLE_PAGE_SIZE_OPTIONS, ADMIN_TEAMS_PATH } from "@/constants"
import { getTeamsAction } from "../../_actions/get-teams.action"
import { AdminTableShell } from "../admin-table-shell"
import { useAdminTablePagination } from "../use-admin-table-pagination"
import { TEAM_TABLE_UNCLICKABLE_COLUMNS, teamColumns, type Team } from "./columns"
import { TeamsBulkActions } from "./teams-bulk-actions"

export function TeamsTable() {
  const {
    page,
    pageSize,
    pageIndex,
    onPageChange,
    onPageSizeChange,
    resetToFirstPage,
  } = useAdminTablePagination()
  const [search, setSearch] = useQueryState("search", { defaultValue: "" })

  const { execute: fetchTeams, result, status } = useAction(getTeamsAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Failed to fetch teams")
    },
  })
  const data = result.data
  const error = result.serverError

  useEffect(() => {
    fetchTeams({ page, pageSize, search })
  }, [fetchTeams, page, pageSize, search])

  const handleSearchChange = (value: string) => {
    setSearch(value)
    resetToFirstPage()
  }

  const getRowHref = useCallback((team: Team) => `${ADMIN_TEAMS_PATH}/${team.id}`, [])

  return (
    <AdminTableShell
      header={
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-3xl font-bold">Teams</h1>
            <p className="text-sm text-muted-foreground">
              Every team on this deployment, newest first.
            </p>
          </div>
          <Input
            placeholder="Search name, slug, or member email..."
            type="search"
            value={search}
            onChange={(event) => handleSearchChange(event.target.value)}
            className="max-w-sm"
          />
        </div>
      }
      isLoading={status === "executing" || status === "idle"}
      loadingMessage="Loading..."
      errorMessage={error ? `Error: ${error.message}` : undefined}
      emptyMessage="No teams found"
      hasData={Boolean(data)}
    >
      {data ? (
        <DataTable
          columns={teamColumns}
          data={data.teams}
          pageCount={data.totalPages}
          pageIndex={pageIndex}
          pageSize={pageSize}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          totalCount={data.totalCount}
          itemNameSingular="team"
          itemNamePlural="teams"
          pageSizeOptions={ADMIN_TABLE_PAGE_SIZE_OPTIONS}
          getRowHref={getRowHref}
          excludeClickableColumns={TEAM_TABLE_UNCLICKABLE_COLUMNS}
          renderSelectionToolbar={({ selectedRows, clearSelection }) => (
            <TeamsBulkActions teams={selectedRows} onClear={clearSelection} />
          )}
        />
      ) : null}
    </AdminTableShell>
  )
}
