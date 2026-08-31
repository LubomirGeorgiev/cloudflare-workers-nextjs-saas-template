"use client"

import { MoreHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard"

interface CopyAction {
  label: string
  value: string
}

// The trailing "..." menu the admin listings put on every row. Every entry so far copies one field
// to the clipboard, so the menu takes values rather than handlers.
export function CopyActionsCell({ actions }: { actions: CopyAction[] }) {
  const { copy } = useCopyToClipboard()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" className="h-8 w-8 p-0" />}>
        <span className="sr-only">Open menu</span>
        <MoreHorizontal className="h-4 w-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        {actions.map((action) => (
          <DropdownMenuItem key={action.label} onClick={() => copy(action.value)}>
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
