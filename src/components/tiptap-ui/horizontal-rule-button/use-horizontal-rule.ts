"use client"

import { useCallback, useEffect, useState } from "react"
import type { Editor } from "@tiptap/react"

import { useTiptapEditor } from "@/hooks/use-tiptap-editor"
import { HorizontalRuleIcon } from "@/components/tiptap-icons/horizontal-rule-icon"
import { isNodeInSchema } from "@/lib/tiptap-utils"

export const HORIZONTAL_RULE_SHORTCUT_KEY = "mod+shift+h"

export interface UseHorizontalRuleConfig {
  editor?: Editor | null
  hideWhenUnavailable?: boolean
  onInserted?: () => void
}

export function canInsertHorizontalRule(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) return false
  if (!isNodeInSchema("horizontalRule", editor)) return false

  return editor.can().setHorizontalRule()
}

export function insertHorizontalRule(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) return false
  if (!canInsertHorizontalRule(editor)) return false

  try {
    editor.chain().focus().setHorizontalRule().run()
    return true
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
  if (!isNodeInSchema("horizontalRule", editor)) return false

  if (hideWhenUnavailable) {
    return canInsertHorizontalRule(editor)
  }

  return true
}

export function useHorizontalRule(config?: UseHorizontalRuleConfig) {
  const {
    editor: providedEditor,
    hideWhenUnavailable = false,
    onInserted,
  } = config || {}

  const { editor } = useTiptapEditor(providedEditor)
  const [isVisible, setIsVisible] = useState<boolean>(true)
  const canInsert = canInsertHorizontalRule(editor)

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

    const success = insertHorizontalRule(editor)
    if (success) {
      onInserted?.()
    }
    return success
  }, [editor, onInserted])

  return {
    isVisible,
    handleInsert,
    canInsert,
    label: "Horizontal Rule",
    shortcutKeys: HORIZONTAL_RULE_SHORTCUT_KEY,
    Icon: HorizontalRuleIcon,
  }
}
