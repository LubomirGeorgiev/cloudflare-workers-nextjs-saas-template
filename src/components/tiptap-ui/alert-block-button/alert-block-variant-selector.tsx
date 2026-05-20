"use client"

import { useCallback, useEffect, useState } from "react"
import type { Editor } from "@tiptap/react"

import {
  getActiveAlertBlockState,
  subscribeToActiveAlertBlock,
} from "@/components/tiptap-node/alert-block/alert-block-toolbar-state"
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"
import { isNodeInSchema } from "@/lib/tiptap-utils"
import {
  ALERT_BLOCK_NODE_NAME,
  ALERT_BLOCK_VARIANTS,
  DEFAULT_ALERT_BLOCK_VARIANT,
} from "@/components/tiptap-node/alert-block/alert-block-types"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const variantLabels = {
  default: "Default",
  info: "Info",
  success: "Success",
  warning: "Warning",
  destructive: "Destructive",
} as const

export interface AlertBlockVariantSelectorProps {
  editor?: Editor | null
}

export function AlertBlockVariantSelector({
  editor: providedEditor,
}: AlertBlockVariantSelectorProps) {
  const { editor } = useTiptapEditor(providedEditor)
  const [currentVariant, setCurrentVariant] = useState<string>(
    DEFAULT_ALERT_BLOCK_VARIANT
  )
  const [isEditingAlertBlock, setIsEditingAlertBlock] = useState(false)
  const isInAlertBlock = editor?.isActive(ALERT_BLOCK_NODE_NAME) ?? false
  const shouldShow = isInAlertBlock || isEditingAlertBlock

  useEffect(() => {
    const updateFromActiveAlert = () => {
      const activeAlert = getActiveAlertBlockState()

      setIsEditingAlertBlock(Boolean(activeAlert))

      if (activeAlert) {
        setCurrentVariant(activeAlert.variant)
      }
    }

    updateFromActiveAlert()

    return subscribeToActiveAlertBlock(updateFromActiveAlert)
  }, [])

  useEffect(() => {
    if (!editor || !isNodeInSchema(ALERT_BLOCK_NODE_NAME, editor)) {
      return
    }

    const handleUpdate = () => {
      if (!editor.isActive(ALERT_BLOCK_NODE_NAME)) {
        setCurrentVariant(DEFAULT_ALERT_BLOCK_VARIANT)
        return
      }

      const attrs = editor.getAttributes(ALERT_BLOCK_NODE_NAME) as {
        variant?: string
      }

      setCurrentVariant(attrs.variant ?? DEFAULT_ALERT_BLOCK_VARIANT)
    }

    handleUpdate()
    editor.on("selectionUpdate", handleUpdate)
    editor.on("transaction", handleUpdate)

    return () => {
      editor.off("selectionUpdate", handleUpdate)
      editor.off("transaction", handleUpdate)
    }
  }, [editor])

  const handleVariantChange = useCallback(
    (variant: string) => {
      const activeAlert = getActiveAlertBlockState()

      if (activeAlert) {
        activeAlert.setVariant(variant as (typeof ALERT_BLOCK_VARIANTS)[number])
        setCurrentVariant(variant)
        return
      }

      if (!editor) {
        return
      }

      editor.chain().focus().updateAttributes(ALERT_BLOCK_NODE_NAME, { variant }).run()
      setCurrentVariant(variant)
    },
    [editor]
  )

  if (!shouldShow) {
    return null
  }

  return (
    <Select value={currentVariant} onValueChange={handleVariantChange}>
      <SelectTrigger
        className="h-8 w-[160px] text-xs"
        aria-label="Alert variant"
      >
        <SelectValue placeholder="Select variant" />
      </SelectTrigger>
      <SelectContent>
        {ALERT_BLOCK_VARIANTS.map((variant) => (
          <SelectItem key={variant} value={variant}>
            {variantLabels[variant]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
