"use client"

import { runTiptapCommand } from "@/lib/tiptap-errors"

import { useCallback, useEffect, useState } from "react"
import { type Editor } from "@tiptap/react"

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"

// --- Icons ---
import { ListIcon } from "@/components/tiptap-icons/list-icon"
import { ListOrderedIcon } from "@/components/tiptap-icons/list-ordered-icon"
import { ListTodoIcon } from "@/components/tiptap-icons/list-todo-icon"

// --- Lib ---
import {
  isNodeInSchema,
  isNodeTypeSelected,
  selectionWithinConvertibleTypes,
  withNormalizedBlockSelection,
} from "@/lib/tiptap-utils"

export type ListType = "bulletList" | "orderedList" | "taskList"

export interface UseListConfig {
  editor?: Editor | null
  type: ListType
  hideWhenUnavailable?: boolean
  onToggled?: () => void
}

export const listIcons = {
  bulletList: ListIcon,
  orderedList: ListOrderedIcon,
  taskList: ListTodoIcon,
}

// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
export const listLabels: Record<ListType, string> = {
  bulletList: "Bullet List",
  orderedList: "Ordered List",
  taskList: "Task List",
}

export const LIST_SHORTCUT_KEYS: Record<ListType, string> = {
  bulletList: "mod+shift+8",
  orderedList: "mod+shift+7",
  taskList: "mod+shift+9",
}

export function canToggleList(
  editor: Editor | null,
  type: ListType,
  turnInto: boolean = true
): boolean {
  if (!editor || !editor.isEditable) {
    return false
  }
  if (!isNodeInSchema(type, editor) || isNodeTypeSelected(editor, ["image"])) {
    return false
  }

  if (!turnInto) {
    switch (type) {
      case "bulletList":
        return editor.can().toggleBulletList()
      case "orderedList":
        return editor.can().toggleOrderedList()
      case "taskList":
        return editor.can().toggleList("taskList", "taskItem")
      default:
        return false
    }
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

  // Either we can set list directly on the selection,
  // or we can clear formatting/nodes to arrive at a list.
  switch (type) {
    case "bulletList":
      return editor.can().toggleBulletList() || editor.can().clearNodes()
    case "orderedList":
      return editor.can().toggleOrderedList() || editor.can().clearNodes()
    case "taskList":
      return (
        editor.can().toggleList("taskList", "taskItem") ||
        editor.can().clearNodes()
      )
    default:
      return false
  }
}

export function isListActive(editor: Editor | null, type: ListType): boolean {
  if (!editor || !editor.isEditable) {
    return false
  }

  switch (type) {
    case "bulletList":
      return editor.isActive("bulletList")
    case "orderedList":
      return editor.isActive("orderedList")
    case "taskList":
      return editor.isActive("taskList")
    default:
      return false
  }
}

// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
export function toggleList(editor: Editor | null, type: ListType): boolean {
  if (!editor || !editor.isEditable) {
    return false
  }
  if (!canToggleList(editor, type)) {
    return false
  }

  return runTiptapCommand({
    id: "toggle-list",
    message: "Could not change the list",
    command: () =>
      withNormalizedBlockSelection({
        editor,
        toggle: (chain) => {
          if (editor.isActive(type)) {
            // Unwrap list
            chain
              .liftListItem("listItem")
              .lift("bulletList")
              .lift("orderedList")
              .lift("taskList")
              .run()

            return true
          }

          // Wrap in specific list type
          const toggleMap: Record<ListType, () => typeof chain> = {
            bulletList: () => chain.toggleBulletList(),
            orderedList: () => chain.toggleOrderedList(),
            taskList: () => chain.toggleList("taskList", "taskItem"),
          }

          const toggle = toggleMap[type]
          if (!toggle) {
            return false
          }

          return toggle().run()
        },
      }),
  })
}

// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
export function shouldShowButton(props: {
  editor: Editor | null
  type: ListType
  hideWhenUnavailable: boolean
}): boolean {
  const { editor, type, hideWhenUnavailable } = props

  if (!editor || !editor.isEditable) {
    return false
  }
  if (!isNodeInSchema(type, editor)) {
    return false
  }

  if (hideWhenUnavailable && !editor.isActive("code")) {
    return canToggleList(editor, type)
  }

  return true
}

export function useList(config: UseListConfig) {
  const {
    editor: providedEditor,
    type,
    hideWhenUnavailable = false,
    onToggled,
  } = config

  const { editor } = useTiptapEditor(providedEditor)
  const [isVisible, setIsVisible] = useState<boolean>(true)
  const canToggle = canToggleList(editor, type)
  const isActive = isListActive(editor, type)

  useEffect(() => {
    if (!editor) {
      return
    }

    const handleSelectionUpdate = () => {
      setIsVisible(shouldShowButton({ editor, type, hideWhenUnavailable }))
    }

    handleSelectionUpdate()

    editor.on("selectionUpdate", handleSelectionUpdate)

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate)
    }
  }, [editor, type, hideWhenUnavailable])

  const handleToggle = useCallback(() => {
    if (!editor) {
      return false
    }

    const success = toggleList(editor, type)
    if (success) {
      onToggled?.()
    }
    return success
  }, [editor, type, onToggled])

  return {
    isVisible,
    isActive,
    handleToggle,
    canToggle,
    label: listLabels[type],
    shortcutKeys: LIST_SHORTCUT_KEYS[type],
    Icon: listIcons[type],
  }
}
