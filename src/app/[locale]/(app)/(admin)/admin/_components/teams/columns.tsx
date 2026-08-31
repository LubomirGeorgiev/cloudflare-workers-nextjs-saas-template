"use client"

import type { ColumnDef } from "@tanstack/react-table"
import type { InferSafeActionFnResult } from "next-safe-action"

import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { ADMIN_TEAMS_PATH, ADMIN_USERS_PATH } from "@/constants"
import { Link } from "@/i18n/navigation"
import type { getTeamsAction } from "../../_actions/get-teams.action"
import { CopyActionsCell } from "../copy-actions-cell"
import { RelativeDateCell } from "../relative-date-cell"

// Derive the row model from the action's return DTO so the table stays in sync.
export type Team = NonNullable<InferSafeActionFnResult<typeof getTeamsAction>["data"]>["teams"][number]

/** Statuses that mean the team is not currently paying; anything else reads as healthy. */
const WARNING_SUBSCRIPTION_STATUSES = new Set([
  "past_due",
  "unpaid",
  "canceled",
  "incomplete_expired",
])

export const teamColumns: ColumnDef<Team>[] = [
  {
    id: "select",
    // Header selects only what is on screen: the action bar acts on ids, and the rows of other
    // pages are not loaded, so "all" could not honestly mean every team that matches the search.
    header: ({ table }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected()}
        indeterminate={table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()}
        onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked)}
        aria-label="Select every team on this page"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(checked) => row.toggleSelected(checked)}
        aria-label={`Select ${row.original.name}`}
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "name",
    header: "Team",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium">{row.original.name}</span>
        <span className="font-mono text-xs text-muted-foreground">{row.original.slug}</span>
      </div>
    ),
  },
  {
    id: "members",
    header: "Members",
    cell: ({ row }) => {
      const { members, memberCount, id } = row.original
      const remaining = memberCount - members.length

      if (memberCount === 0) {
        return <span className="text-muted-foreground">No members</span>
      }

      return (
        <div className="flex flex-wrap items-center gap-1">
          {members.map((member) => (
            <Link
              key={member.userId}
              href={`${ADMIN_USERS_PATH}/${member.userId}`}
              className="rounded-md bg-muted px-2 py-0.5 text-xs hover:underline"
            >
              {member.email || member.name || member.userId}
            </Link>
          ))}
          {remaining > 0 ? (
            <Link
              href={`${ADMIN_TEAMS_PATH}/${id}`}
              className="px-1 text-xs text-muted-foreground hover:underline"
            >
              +{remaining} more
            </Link>
          ) : null}
        </div>
      )
    },
  },
  {
    accessorKey: "memberCount",
    header: "Size",
  },
  {
    accessorKey: "planId",
    header: "Plan",
    cell: ({ row }) => <Badge variant="secondary">{row.original.planId}</Badge>,
  },
  {
    accessorKey: "subscriptionStatus",
    header: "Subscription",
    cell: ({ row }) => {
      const status = row.original.subscriptionStatus

      if (!status) {
        return <span className="text-muted-foreground">None</span>
      }

      return (
        <Badge variant={WARNING_SUBSCRIPTION_STATUSES.has(status) ? "destructive" : "default"}>
          {status}
        </Badge>
      )
    },
  },
  {
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => <RelativeDateCell value={row.original.createdAt} />,
  },
  {
    id: "actions",
    cell: ({ row }) => (
      <CopyActionsCell
        actions={[
          { label: "Copy team ID", value: row.original.id },
          { label: "Copy slug", value: row.original.slug },
        ]}
      />
    ),
  },
]

/** Columns whose cells own their own links or controls, so the row link must not wrap them. */
export const TEAM_TABLE_UNCLICKABLE_COLUMNS = ["select", "members", "actions"]
