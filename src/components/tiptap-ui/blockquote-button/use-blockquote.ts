"use client"

import { runTiptapCommand } from "@/lib/tiptap-errors"

import { useCallback, useEffect, useState } from "react"
import type { Editor } from "@tiptap/react"

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"

// --- Icons ---
import { BlockquoteIcon } from "@/components/tiptap-icons/blockquote-icon"

// --- UI Utils ---
import {
  isNodeInSchema,
  isNodeTypeSelected,
  selectionWithinConvertibleTypes,
  withNormalizedBlockSelection,
} from "@/lib/tiptap-utils"

export const BLOCKQUOTE_SHORTCUT_KEY = "mod+shift+b"

export interface UseBlockquoteConfig {
  editor?: Editor | null
  hideWhenUnavailable?: boolean
  onToggled?: () => void
}

// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
export function canToggleBlockquote(
  editor: Editor | null,
  turnInto: boolean = true
): boolean {
  if (!editor || !editor.isEditable) {
    return false
  }
  if (
    !isNodeInSchema("blockquote", editor) ||
    isNodeTypeSelected(editor, ["image"])
  ) {
    return false
  }

  if (!turnInto) {
    return editor.can().toggleWrap("blockquote")
  }

  // Ensure selection is in nodes we're allowed to convert
  if (
    !selectionWithinConvertibleTypes(editor, [
      "paragraph",
      "heading",
      "bulletList",
      "orderedList",
      "taskList",
      "blockquote",
      "codeBlock",
    ])
  ) {
    return false
  }

  // Either we can wrap in blockquote directly on the selection,
  // or we can clear formatting/nodes to arrive at a blockquote.
  return editor.can().toggleWrap("blockquote") || editor.can().clearNodes()
}

// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
export function toggleBlockquote(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) {
    return false
  }
  if (!canToggleBlockquote(editor)) {
    return false
  }

  return runTiptapCommand({
    id: "toggle-blockquote",
    message: "Could not change the blockquote",
    command: () =>
      withNormalizedBlockSelection({
        editor,
        toggle: (chain) => {
          const toggle = editor.isActive("blockquote")
            ? chain.lift("blockquote")
            : chain.wrapIn("blockquote")

          return toggle.run()
        },
      }),
  })
}

// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
export function shouldShowButton(props: {
  editor: Editor | null
  hideWhenUnavailable: boolean
}): boolean {
  const { editor, hideWhenUnavailable } = props

  if (!editor || !editor.isEditable) {
    return false
  }
  if (!isNodeInSchema("blockquote", editor)) {
    return false
  }

  if (hideWhenUnavailable && !editor.isActive("code")) {
    return canToggleBlockquote(editor)
  }

  return true
}

export function useBlockquote(config?: UseBlockquoteConfig) {
  const {
    editor: providedEditor,
    hideWhenUnavailable = false,
    onToggled,
  } = config || {}

  const { editor } = useTiptapEditor(providedEditor)
  const [isVisible, setIsVisible] = useState<boolean>(true)
  const canToggle = canToggleBlockquote(editor)
  const isActive = editor?.isActive("blockquote") || false

  useEffect(() => {
    if (!editor) {
      return
    }

    const handleSelectionUpdate = () => {
      setIsVisible(shouldShowButton({ editor, hideWhenUnavailable }))
    }

    handleSelectionUpdate()

    editor.on("selectionUpdate", handleSelectionUpdate)

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate)
    }
  }, [editor, hideWhenUnavailable])

  const handleToggle = useCallback(() => {
    if (!editor) {
      return false
    }

    const success = toggleBlockquote(editor)
    if (success) {
      onToggled?.()
    }
    return success
  }, [editor, onToggled])

  return {
    isVisible,
    isActive,
    handleToggle,
    canToggle,
    label: "Blockquote",
    shortcutKeys: BLOCKQUOTE_SHORTCUT_KEY,
    Icon: BlockquoteIcon,
  }
}
