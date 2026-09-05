"use client"

import { runTiptapCommand } from "@/lib/tiptap-errors"

import { useCallback, useEffect, useState } from "react"
import type { ChainedCommands } from "@tiptap/react"
import { type Editor } from "@tiptap/react"

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"

// --- Lib ---
import {
  isExtensionAvailable,
  isNodeTypeSelected,
} from "@/lib/tiptap-utils"

// --- Icons ---
import { AlignCenterIcon } from "@/components/tiptap-icons/align-center-icon"
import { AlignJustifyIcon } from "@/components/tiptap-icons/align-justify-icon"
import { AlignLeftIcon } from "@/components/tiptap-icons/align-left-icon"
import { AlignRightIcon } from "@/components/tiptap-icons/align-right-icon"

export type TextAlign = "left" | "center" | "right" | "justify"

export interface UseTextAlignConfig {
  editor?: Editor | null
  align: TextAlign
  hideWhenUnavailable?: boolean
  onAligned?: () => void
}

export const TEXT_ALIGN_SHORTCUT_KEYS: Record<TextAlign, string> = {
  left: "mod+shift+l",
  center: "mod+shift+e",
  right: "mod+shift+r",
  justify: "mod+shift+j",
}

// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
export const textAlignIcons = {
  left: AlignLeftIcon,
  center: AlignCenterIcon,
  right: AlignRightIcon,
  justify: AlignJustifyIcon,
}

// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
export const textAlignLabels: Record<TextAlign, string> = {
  left: "Align left",
  center: "Align center",
  right: "Align right",
  justify: "Align justify",
}

// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
export function canSetTextAlign(
  editor: Editor | null,
  align: TextAlign
): boolean {
  if (!editor || !editor.isEditable) {
    return false
  }
  if (
    !isExtensionAvailable(editor, "textAlign") ||
    isNodeTypeSelected(editor, ["image", "horizontalRule"])
  ) {
    return false
  }

  return editor.can().setTextAlign(align)
}

// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
export function hasSetTextAlign(
  commands: ChainedCommands
): commands is ChainedCommands & {
  setTextAlign: (align: TextAlign) => ChainedCommands
} {
  return "setTextAlign" in commands
}

// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
export function isTextAlignActive(
  editor: Editor | null,
  align: TextAlign
): boolean {
  if (!editor || !editor.isEditable) {
    return false
  }
  return editor.isActive({ textAlign: align })
}

// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
export function setTextAlign(editor: Editor | null, align: TextAlign): boolean {
  if (!editor || !editor.isEditable) {
    return false
  }
  if (!canSetTextAlign(editor, align)) {
    return false
  }

  return runTiptapCommand({
    id: "set-text-align",
    message: "Could not change the text alignment",
    command: () => {
      const chain = editor.chain().focus()
      return hasSetTextAlign(chain) && chain.setTextAlign(align).run()
    },
  })
}

// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
export function shouldShowButton(props: {
  editor: Editor | null
  hideWhenUnavailable: boolean
  align: TextAlign
}): boolean {
  const { editor, hideWhenUnavailable, align } = props

  if (!editor || !editor.isEditable) {
    return false
  }
  if (!isExtensionAvailable(editor, "textAlign")) {
    return false
  }

  if (hideWhenUnavailable && !editor.isActive("code")) {
    return canSetTextAlign(editor, align)
  }

  return true
}

export function useTextAlign(config: UseTextAlignConfig) {
  const {
    editor: providedEditor,
    align,
    hideWhenUnavailable = false,
    onAligned,
  } = config

  const { editor } = useTiptapEditor(providedEditor)
  const [isVisible, setIsVisible] = useState<boolean>(true)
  const canAlign = canSetTextAlign(editor, align)
  const isActive = isTextAlignActive(editor, align)

  useEffect(() => {
    if (!editor) {
      return
    }

    const handleSelectionUpdate = () => {
      setIsVisible(shouldShowButton({ editor, align, hideWhenUnavailable }))
    }

    handleSelectionUpdate()

    editor.on("selectionUpdate", handleSelectionUpdate)

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate)
    }
  }, [editor, hideWhenUnavailable, align])

  const handleTextAlign = useCallback(() => {
    if (!editor) {
      return false
    }

    const success = setTextAlign(editor, align)
    if (success) {
      onAligned?.()
    }
    return success
  }, [editor, align, onAligned])

  return {
    isVisible,
    isActive,
    handleTextAlign,
    canAlign,
    label: textAlignLabels[align],
    shortcutKeys: TEXT_ALIGN_SHORTCUT_KEYS[align],
    Icon: textAlignIcons[align],
  }
}
