"use client"

import { ReactNodeViewRenderer } from "@tiptap/react"

import { AlertBlockExtension } from "@/components/tiptap-node/alert-block/alert-block-extension"
import { AlertBlockNode } from "@/components/tiptap-node/alert-block/alert-block-node"

export const AlertBlockEditorExtension = AlertBlockExtension.extend({
  addNodeView() {
    return ReactNodeViewRenderer(AlertBlockNode)
  },
})
