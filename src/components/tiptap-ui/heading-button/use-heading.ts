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
import { HeadingOneIcon } from "@/components/tiptap-icons/heading-one-icon"
import { HeadingTwoIcon } from "@/components/tiptap-icons/heading-two-icon"
import { HeadingThreeIcon } from "@/components/tiptap-icons/heading-three-icon"
import { HeadingFourIcon } from "@/components/tiptap-icons/heading-four-icon"
import { HeadingFiveIcon } from "@/components/tiptap-icons/heading-five-icon"
import { HeadingSixIcon } from "@/components/tiptap-icons/heading-six-icon"

export type Level = 1 | 2 | 3 | 4 | 5 | 6

export interface UseHeadingConfig {
  editor?: Editor | null
  level: Level
  hideWhenUnavailable?: boolean
  onToggled?: () => void
}

export const headingIcons = {
  1: HeadingOneIcon,
  2: HeadingTwoIcon,
  3: HeadingThreeIcon,
  4: HeadingFourIcon,
  5: HeadingFiveIcon,
  6: HeadingSixIcon,
}

export const HEADING_SHORTCUT_KEYS: Record<Level, string> = {
  1: "ctrl+alt+1",
  2: "ctrl+alt+2",
  3: "ctrl+alt+3",
  4: "ctrl+alt+4",
  5: "ctrl+alt+5",
  6: "ctrl+alt+6",
}

export function canToggle(
  editor: Editor | null,
  level?: Level,
  turnInto: boolean = true
): boolean {
  if (!editor || !editor.isEditable) {
    return false
  }
  if (
    !isNodeInSchema("heading", editor) ||
    isNodeTypeSelected(editor, ["image"])
  ) {
    return false
  }

  if (!turnInto) {
    return level
      ? editor.can().setNode("heading", { level })
      : editor.can().setNode("heading")
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

  // Either we can set heading directly on the selection,
  // or we can clear formatting/nodes to arrive at a heading.
  return level
    ? editor.can().setNode("heading", { level }) || editor.can().clearNodes()
    : editor.can().setNode("heading") || editor.can().clearNodes()
}

export function isHeadingActive(
  editor: Editor | null,
  level?: Level | Level[]
): boolean {
  if (!editor || !editor.isEditable) {
    return false
  }

  if (Array.isArray(level)) {
    return level.some((l) => editor.isActive("heading", { level: l }))
  }

  return level
    ? editor.isActive("heading", { level })
    : editor.isActive("heading")
}

// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
export function toggleHeading(
  editor: Editor | null,
  level: Level | Level[]
): boolean {
  if (!editor || !editor.isEditable) {
    return false
  }

  const levels = Array.isArray(level) ? level : [level]
  const toggleLevel = levels.find((l) => canToggle(editor, l))

  if (!toggleLevel) {
    return false
  }

  return runTiptapCommand({
    id: "toggle-heading",
    message: "Could not change the heading",
    command: () =>
      withNormalizedBlockSelection({
        editor,
        toggle: (chain) => {
          const isActive = levels.some((l) =>
            editor.isActive("heading", { level: l })
          )

          const toggle = isActive
            ? chain.setNode("paragraph")
            : chain.setNode("heading", { level: toggleLevel })

          return toggle.run()
        },
      }),
  })
}

export function shouldShowButton(props: {
  editor: Editor | null
  level?: Level | Level[]
  hideWhenUnavailable: boolean
}): boolean {
  const { editor, level, hideWhenUnavailable } = props

  if (!editor || !editor.isEditable) {
    return false
  }
  if (!isNodeInSchema("heading", editor)) {
    return false
  }

  if (hideWhenUnavailable && !editor.isActive("code")) {
    if (Array.isArray(level)) {
      return level.some((l) => canToggle(editor, l))
    }
    return canToggle(editor, level)
  }

  return true
}

export function useHeading(config: UseHeadingConfig) {
  const {
    editor: providedEditor,
    level,
    hideWhenUnavailable = false,
    onToggled,
  } = config

  const { editor } = useTiptapEditor(providedEditor)
  const [isVisible, setIsVisible] = useState<boolean>(true)
  const canToggleState = canToggle(editor, level)
  const isActive = isHeadingActive(editor, level)

  useEffect(() => {
    if (!editor) {
      return
    }

    const handleSelectionUpdate = () => {
      setIsVisible(shouldShowButton({ editor, level, hideWhenUnavailable }))
    }

    handleSelectionUpdate()

    editor.on("selectionUpdate", handleSelectionUpdate)

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate)
    }
  }, [editor, level, hideWhenUnavailable])

  const handleToggle = useCallback(() => {
    if (!editor) {
      return false
    }

    const success = toggleHeading(editor, level)
    if (success) {
      onToggled?.()
    }
    return success
  }, [editor, level, onToggled])

  return {
    isVisible,
    isActive,
    handleToggle,
    canToggle: canToggleState,
    label: `Heading ${level}`,
    shortcutKeys: HEADING_SHORTCUT_KEYS[level],
    Icon: headingIcons[level],
  }
}
