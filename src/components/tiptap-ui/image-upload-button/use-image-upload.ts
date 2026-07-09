"use client"

import { useCallback, useEffect, useState } from "react"
import { useHotkeys } from "react-hotkeys-hook"
import { type Editor } from "@tiptap/react"

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"
import { useIsBreakpoint } from "@/hooks/use-is-breakpoint"

// --- Lib ---
import { isExtensionAvailable } from "@/lib/tiptap-utils"

// --- Icons ---
import { ImagePlusIcon } from "@/components/tiptap-icons/image-plus-icon"

export const IMAGE_UPLOAD_SHORTCUT_KEY = "mod+shift+i"

export interface UseImageUploadConfig {
  editor?: Editor | null
  hideWhenUnavailable?: boolean
  onInserted?: () => void
}

// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
export function canInsertImage(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) return false
  if (!isExtensionAvailable(editor, "imageUpload")) return false

  return editor.can().insertContent({ type: "imageUpload" })
}

// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
export function isImageActive(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) return false
  return editor.isActive("imageUpload")
}

// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
export function insertImage(editor: Editor | null): boolean {
  if (!editor || !editor.isEditable) return false
  if (!canInsertImage(editor)) return false

  try {
    return editor
      .chain()
      .focus()
      .insertContent({
        type: "imageUpload",
      })
      .run()
  } catch {
    return false
  }
}

// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
export function shouldShowButton(props: {
  editor: Editor | null
  hideWhenUnavailable: boolean
}): boolean {
  const { editor, hideWhenUnavailable } = props

  if (!editor || !editor.isEditable) return false
  if (!isExtensionAvailable(editor, "imageUpload")) return false

  if (hideWhenUnavailable && !editor.isActive("code")) {
    return canInsertImage(editor)
  }

  return true
}

export function useImageUpload(config?: UseImageUploadConfig) {
  const {
    editor: providedEditor,
    hideWhenUnavailable = false,
    onInserted,
  } = config || {}

  const { editor } = useTiptapEditor(providedEditor)
  const isMobile = useIsBreakpoint()
  const [isVisible, setIsVisible] = useState<boolean>(true)
  const canInsert = canInsertImage(editor)
  const isActive = isImageActive(editor)

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

  const handleImage = useCallback(() => {
    if (!editor) return false

    const success = insertImage(editor)
    if (success) {
      onInserted?.()
    }
    return success
  }, [editor, onInserted])

  useHotkeys(
    IMAGE_UPLOAD_SHORTCUT_KEY,
    (event) => {
      event.preventDefault()
      handleImage()
    },
    {
      enabled: isVisible && canInsert,
      enableOnContentEditable: !isMobile,
      enableOnFormTags: true,
    }
  )

  return {
    isVisible,
    isActive,
    handleImage,
    canInsert,
    label: "Add image",
    shortcutKeys: IMAGE_UPLOAD_SHORTCUT_KEY,
    Icon: ImagePlusIcon,
  }
}
