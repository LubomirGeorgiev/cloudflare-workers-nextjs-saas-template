"use client"

import { ColumnDef } from "@tanstack/react-table"
import type { InferSafeActionFnResult } from "next-safe-action"
import { CopyActionsCell } from "../copy-actions-cell"
import { RelativeDateCell } from "../relative-date-cell"
import type { getUsersAction } from "../../_actions/get-users.action"

import { Badge } from "@/components/ui/badge"

// Derive the row model from the action's return DTO so the table stays in sync.
export type User = NonNullable<InferSafeActionFnResult<typeof getUsersAction>["data"]>["users"][number]

export const columns: ColumnDef<User>[] = [
  {
    accessorKey: "email",
    header: "Email",
  },
  {
    accessorKey: "name",
    header: "Name",
  },
  {
    accessorKey: "role",
    header: "Role",
    cell: ({ row }) => {
      const role = row.getValue("role") as string
      return (
        <Badge variant={role === "admin" ? "default" : "secondary"}>
          {role}
        </Badge>
      )
    },
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.getValue("status") as string
      return (
        <Badge variant={status === "active" ? "default" : "destructive"}>
          {status}
        </Badge>
      )
    },
  },
  {
    accessorKey: "createdAt",
    header: "Created",
    cell: ({ row }) => <RelativeDateCell value={row.getValue("createdAt") as Date} />,
  },
  {
    accessorKey: "lastActiveAt",
    header: "Last Active",
    cell: ({ row }) => (
      <RelativeDateCell value={row.getValue("lastActiveAt") as Date | null} emptyLabel="Never" />
    ),
  },
  {
    id: "actions",
    cell: ({ row }) => (
      <CopyActionsCell
        actions={[
          { label: "Copy user ID", value: row.original.id },
          { label: "Copy email", value: row.original.email || "" },
        ]}
      />
    ),
  },
]
