"use client"

import { useCallback, useState } from "react"
import { type Editor } from "@tiptap/react"

import { useTiptapEditor } from "@/hooks/use-tiptap-editor"
import { ChevronDownIcon } from "@/components/tiptap-icons/chevron-down-icon"
import { TableRowPlusIcon } from "@/components/tiptap-icons/table-row-plus-icon"
import { TableColumnPlusIcon } from "@/components/tiptap-icons/table-column-plus-icon"
import { TrashIcon } from "@/components/tiptap-icons/trash-icon"
import { useTableDropdownMenu } from "./use-table-dropdown-menu"
import type { ButtonProps } from "@/components/tiptap-ui-primitive/button"
import { Button, ButtonGroup } from "@/components/tiptap-ui-primitive/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/tiptap-ui-primitive/dropdown-menu"
import { Card, CardBody } from "@/components/tiptap-ui-primitive/card"

export interface TableDropdownMenuProps extends Omit<ButtonProps, "type"> {
  editor?: Editor
  hideWhenUnavailable?: boolean
  onOpenChange?: (isOpen: boolean) => void
  portal?: boolean
}

export function TableDropdownMenu({
  editor: providedEditor,
  hideWhenUnavailable = true,
  onOpenChange,
  portal = false,
  ...props
}: TableDropdownMenuProps) {
  const { editor } = useTiptapEditor(providedEditor)
  const [isOpen, setIsOpen] = useState(false)

  const {
    isVisible,
    isActive,
    isInsideTable,
    canAddColumnBefore,
    canAddColumnAfter,
    canDeleteColumn,
    canAddRowBefore,
    canAddRowAfter,
    canDeleteRow,
    canDeleteTable,
    Icon,
  } = useTableDropdownMenu({
    editor,
    hideWhenUnavailable,
  })

  const handleOnOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open)
      onOpenChange?.(open)
    },
    [onOpenChange]
  )

  const handleAddColumnBefore = useCallback(() => {
    editor?.chain().focus().addColumnBefore().run()
    setIsOpen(false)
  }, [editor])

  const handleAddColumnAfter = useCallback(() => {
    editor?.chain().focus().addColumnAfter().run()
    setIsOpen(false)
  }, [editor])

  const handleDeleteColumn = useCallback(() => {
    editor?.chain().focus().deleteColumn().run()
    setIsOpen(false)
  }, [editor])

  const handleAddRowBefore = useCallback(() => {
    editor?.chain().focus().addRowBefore().run()
    setIsOpen(false)
  }, [editor])

  const handleAddRowAfter = useCallback(() => {
    editor?.chain().focus().addRowAfter().run()
    setIsOpen(false)
  }, [editor])

  const handleDeleteRow = useCallback(() => {
    editor?.chain().focus().deleteRow().run()
    setIsOpen(false)
  }, [editor])

  const handleDeleteTable = useCallback(() => {
    editor?.chain().focus().deleteTable().run()
    setIsOpen(false)
  }, [editor])

  if (!isVisible) {
    return null
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={handleOnOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          data-style="ghost"
          data-active-state={isActive ? "on" : "off"}
          role="button"
          tabIndex={-1}
          disabled={!isInsideTable}
          data-disabled={!isInsideTable}
          aria-label="Table options"
          tooltip={isInsideTable ? "Table options" : "Select a table cell first"}
          {...props}
        >
          <Icon className="tiptap-button-icon" />
          <ChevronDownIcon className="tiptap-button-dropdown-small" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" portal={portal}>
        <Card>
          <CardBody>
            <div className="flex flex-col gap-1">
              <div className="text-xs font-semibold px-2 py-1 text-muted-foreground">
                Columns
              </div>
              <ButtonGroup>
                <DropdownMenuItem asChild>
                  <Button
                    type="button"
                    data-style="ghost"
                    onClick={handleAddColumnBefore}
                    disabled={!canAddColumnBefore}
                    className="w-full justify-start"
                  >
                    <TableColumnPlusIcon className="tiptap-button-icon" />
                    <span className="tiptap-button-text">Insert column before</span>
                  </Button>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Button
                    type="button"
                    data-style="ghost"
                    onClick={handleAddColumnAfter}
                    disabled={!canAddColumnAfter}
                    className="w-full justify-start"
                  >
                    <TableColumnPlusIcon className="tiptap-button-icon" />
                    <span className="tiptap-button-text">Insert column after</span>
                  </Button>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Button
                    type="button"
                    data-style="ghost"
                    onClick={handleDeleteColumn}
                    disabled={!canDeleteColumn}
                    className="w-full justify-start text-destructive"
                  >
                    <TrashIcon className="tiptap-button-icon" />
                    <span className="tiptap-button-text">Delete column</span>
                  </Button>
                </DropdownMenuItem>
              </ButtonGroup>

              <div className="border-t border-border my-1" />

              <div className="text-xs font-semibold px-2 py-1 text-muted-foreground">
                Rows
              </div>
              <ButtonGroup>
                <DropdownMenuItem asChild>
                  <Button
                    type="button"
                    data-style="ghost"
                    onClick={handleAddRowBefore}
                    disabled={!canAddRowBefore}
                    className="w-full justify-start"
                  >
                    <TableRowPlusIcon className="tiptap-button-icon" />
                    <span className="tiptap-button-text">Insert row above</span>
                  </Button>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Button
                    type="button"
                    data-style="ghost"
                    onClick={handleAddRowAfter}
                    disabled={!canAddRowAfter}
                    className="w-full justify-start"
                  >
                    <TableRowPlusIcon className="tiptap-button-icon" />
                    <span className="tiptap-button-text">Insert row below</span>
                  </Button>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Button
                    type="button"
                    data-style="ghost"
                    onClick={handleDeleteRow}
                    disabled={!canDeleteRow}
                    className="w-full justify-start text-destructive"
                  >
                    <TrashIcon className="tiptap-button-icon" />
                    <span className="tiptap-button-text">Delete row</span>
                  </Button>
                </DropdownMenuItem>
              </ButtonGroup>

              <div className="border-t border-border my-1" />

              <ButtonGroup>
                <DropdownMenuItem asChild>
                  <Button
                    type="button"
                    data-style="ghost"
                    onClick={handleDeleteTable}
                    disabled={!canDeleteTable}
                    className="w-full justify-start text-destructive"
                  >
                    <TrashIcon className="tiptap-button-icon" />
                    <span className="tiptap-button-text">Delete table</span>
                  </Button>
                </DropdownMenuItem>
              </ButtonGroup>
            </div>
          </CardBody>
        </Card>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default TableDropdownMenu
