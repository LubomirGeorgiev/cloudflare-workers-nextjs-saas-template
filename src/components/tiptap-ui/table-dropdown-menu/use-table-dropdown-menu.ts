"use client"

import { useEffect, useState } from "react"
import type { Editor } from "@tiptap/react"

import { useTiptapEditor } from "@/hooks/use-tiptap-editor"
import { TableIcon } from "@/components/tiptap-icons/table-icon"
import { isNodeInSchema } from "@/lib/tiptap-utils"

export interface UseTableDropdownMenuConfig {
  editor?: Editor | null
  hideWhenUnavailable?: boolean
}

export function shouldShowTableMenu(props: {
  editor: Editor | null
  hideWhenUnavailable: boolean
}): boolean {
  const { editor, hideWhenUnavailable } = props

  if (!editor || !editor.isEditable) return false
  if (!isNodeInSchema("table", editor)) return false

  if (hideWhenUnavailable && !editor.isActive("table")) {
    return false
  }

  return true
}

export function useTableDropdownMenu(config?: UseTableDropdownMenuConfig) {
  const { editor: providedEditor, hideWhenUnavailable = false } = config || {}

  const { editor } = useTiptapEditor(providedEditor)
  const [isVisible, setIsVisible] = useState<boolean>(true)
  const isActive = editor?.isActive("table") || false

  useEffect(() => {
    if (!editor) return

    const handleSelectionUpdate = () => {
      setIsVisible(shouldShowTableMenu({ editor, hideWhenUnavailable }))
    }

    handleSelectionUpdate()

    editor.on("selectionUpdate", handleSelectionUpdate)

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate)
    }
  }, [editor, hideWhenUnavailable])

  const isInsideTable = editor?.isActive("table") || false

  return {
    isVisible,
    isActive,
    isInsideTable,
    canAddColumnBefore: isInsideTable,
    canAddColumnAfter: isInsideTable,
    canDeleteColumn: isInsideTable,
    canAddRowBefore: isInsideTable,
    canAddRowAfter: isInsideTable,
    canDeleteRow: isInsideTable,
    canDeleteTable: isInsideTable,
    canMergeCells: isInsideTable,
    canSplitCell: isInsideTable,
    Icon: TableIcon,
  }
}
