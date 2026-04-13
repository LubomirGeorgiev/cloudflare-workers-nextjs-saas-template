"use client"

import { useCallback, useEffect, useState } from "react"
import type { Editor } from "@tiptap/react"

import { useTiptapEditor } from "@/hooks/use-tiptap-editor"
import { TableIcon } from "@/components/tiptap-icons/table-icon"
import { isNodeInSchema } from "@/lib/tiptap-utils"

export const TABLE_SHORTCUT_KEY = "mod+shift+t"

export interface UseTableConfig {
  editor?: Editor | null
  hideWhenUnavailable?: boolean
  onInserted?: () => void
  rows?: number
  cols?: number
  withHeaderRow?: boolean
}

export function canInsertTable(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) return false
  if (!isNodeInSchema("table", editor)) return false

  return true
}

export function insertTable(
  editor: Editor | null,
  options?: { rows?: number; cols?: number; withHeaderRow?: boolean }
): boolean {
  if (!editor || !editor.isEditable) return false
  if (!canInsertTable(editor)) return false

  try {
    return editor.commands.insertTable({
      rows: options?.rows ?? 3,
      cols: options?.cols ?? 3,
      withHeaderRow: options?.withHeaderRow ?? true,
    })
  } catch {
    return false
  }
}

export function shouldShowButton(props: {
  editor: Editor | null
  hideWhenUnavailable: boolean
}): boolean {
  const { editor, hideWhenUnavailable } = props

  if (!editor || !editor.isEditable) return false
  if (!isNodeInSchema("table", editor)) return false

  if (hideWhenUnavailable) {
    return canInsertTable(editor)
  }

  return true
}

export function useTable(config?: UseTableConfig) {
  const {
    editor: providedEditor,
    hideWhenUnavailable = false,
    onInserted,
    rows = 3,
    cols = 3,
    withHeaderRow = true,
  } = config || {}

  const { editor } = useTiptapEditor(providedEditor)
  const [isVisible, setIsVisible] = useState<boolean>(true)
  const canInsert = canInsertTable(editor)
  const isActive = editor?.isActive("table") || false

  useEffect(() => {
    if (!editor) return

    const handleSelectionUpdate = () => {
      setIsVisible(shouldShowButton({ editor, hideWhenUnavailable }))
    }

    handleSelectionUpdate()

    editor.on("selectionUpdate", handleSelectionUpdate)

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate)
    }
  }, [editor, hideWhenUnavailable])

  const handleInsert = useCallback(() => {
    if (!editor) return false

    const success = insertTable(editor, { rows, cols, withHeaderRow })
    if (success) {
      onInserted?.()
    }
    return success
  }, [editor, rows, cols, withHeaderRow, onInserted])

  return {
    isVisible,
    isActive,
    handleInsert,
    canInsert,
    label: "Insert Table",
    shortcutKeys: TABLE_SHORTCUT_KEY,
    Icon: TableIcon,
  }
}
