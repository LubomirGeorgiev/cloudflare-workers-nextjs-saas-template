"use client"

import { runTiptapCommand } from "@/lib/tiptap-errors"

import { useCallback, useEffect, useState } from "react"
import { type Editor } from "@tiptap/react"

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"

// --- Lib ---
import {
  isNodeInSchema,
  isNodeTypeSelected,
  selectionWithinConvertibleTypes,
  withNormalizedBlockSelection,
} from "@/lib/tiptap-utils"

// --- Icons ---
import { CodeBlockIcon } from "@/components/tiptap-icons/code-block-icon"

export const CODE_BLOCK_SHORTCUT_KEY = "mod+alt+c"

export interface UseCodeBlockConfig {
  editor?: Editor | null
  hideWhenUnavailable?: boolean
  onToggled?: () => void
}

// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
export function canToggle(
  editor: Editor | null,
  turnInto: boolean = true
): boolean {
  if (!editor || !editor.isEditable) {
    return false
  }
  if (
    !isNodeInSchema("codeBlock", editor) ||
    isNodeTypeSelected(editor, ["image"])
  ) {
    return false
  }

  if (!turnInto) {
    return editor.can().toggleNode("codeBlock", "paragraph")
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

  // Either we can toggle code block directly on the selection,
  // or we can clear formatting/nodes to arrive at a code block.
  return (
    editor.can().toggleNode("codeBlock", "paragraph") ||
    editor.can().clearNodes()
  )
}

// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
export function toggleCodeBlock(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) {
    return false
  }
  if (!canToggle(editor)) {
    return false
  }

  return runTiptapCommand({
    id: "toggle-code-block",
    message: "Could not change the code block",
    command: () =>
      withNormalizedBlockSelection({
        editor,
        toggle: (chain) => {
          const toggle = editor.isActive("codeBlock")
            ? chain.setNode("paragraph")
            : chain.toggleNode("codeBlock", "paragraph")

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
  if (!isNodeInSchema("codeBlock", editor)) {
    return false
  }

  if (hideWhenUnavailable && !editor.isActive("code")) {
    return canToggle(editor)
  }

  return true
}

export function useCodeBlock(config?: UseCodeBlockConfig) {
  const {
    editor: providedEditor,
    hideWhenUnavailable = false,
    onToggled,
  } = config || {}

  const { editor } = useTiptapEditor(providedEditor)
  const [isVisible, setIsVisible] = useState<boolean>(true)
  const canToggleState = canToggle(editor)
  const isActive = editor?.isActive("codeBlock") || false

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

    const success = toggleCodeBlock(editor)
    if (success) {
      onToggled?.()
    }
    return success
  }, [editor, onToggled])

  return {
    isVisible,
    isActive,
    handleToggle,
    canToggle: canToggleState,
    label: "Code Block",
    shortcutKeys: CODE_BLOCK_SHORTCUT_KEY,
    Icon: CodeBlockIcon,
  }
}
