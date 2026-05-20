"use client"

import { useCallback, useEffect, useState } from "react"
import type { Editor } from "@tiptap/react"

import { getActiveAlertBlockState, subscribeToActiveAlertBlock } from "@/components/tiptap-node/alert-block/alert-block-toolbar-state"
import { ALERT_BLOCK_NODE_NAME } from "@/components/tiptap-node/alert-block/alert-block-types"
import { AlertCircleIcon } from "@/components/tiptap-icons/alert-circle-icon"
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"
import { isNodeInSchema, isNodeTypeSelected } from "@/lib/tiptap-utils"

export interface UseAlertBlockConfig {
  editor?: Editor | null
  hideWhenUnavailable?: boolean
  onInserted?: () => void
}

// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
export function canInsertAlertBlock(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) return false
  if (!isNodeInSchema(ALERT_BLOCK_NODE_NAME, editor)) return false
  if (isNodeTypeSelected(editor, ["image"])) return false

  return editor.can().insertContent({
    type: ALERT_BLOCK_NODE_NAME,
  })
}

// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
export function insertAlertBlock(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) return false
  if (!canInsertAlertBlock(editor)) return false

  try {
    editor.chain().focus().setAlertBlock().run()
    return true
  } catch {
    return false
  }
}

function shouldShowButton(props: {
  editor: Editor | null
  hideWhenUnavailable: boolean
}): boolean {
  const { editor, hideWhenUnavailable } = props

  if (!editor || !editor.isEditable) return false
  if (!isNodeInSchema(ALERT_BLOCK_NODE_NAME, editor)) return false

  if (hideWhenUnavailable) {
    return canInsertAlertBlock(editor)
  }

  return true
}

export function useAlertBlock(config?: UseAlertBlockConfig) {
  const {
    editor: providedEditor,
    hideWhenUnavailable = false,
    onInserted,
  } = config || {}

  const { editor } = useTiptapEditor(providedEditor)
  const [isVisible, setIsVisible] = useState(true)
  const [isEditingAlertBlock, setIsEditingAlertBlock] = useState(false)
  const canInsert = canInsertAlertBlock(editor)
  const isActive = (editor?.isActive(ALERT_BLOCK_NODE_NAME) ?? false) || isEditingAlertBlock

  useEffect(() => {
    const updateActiveState = () => {
      setIsEditingAlertBlock(Boolean(getActiveAlertBlockState()))
    }

    updateActiveState()

    return subscribeToActiveAlertBlock(updateActiveState)
  }, [])

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
    const success = insertAlertBlock(editor)

    if (success) {
      onInserted?.()
    }

    return success
  }, [editor, onInserted])

  return {
    isVisible,
    isActive,
    canInsert,
    handleInsert,
    label: "Alert",
    Icon: AlertCircleIcon,
  }
}
