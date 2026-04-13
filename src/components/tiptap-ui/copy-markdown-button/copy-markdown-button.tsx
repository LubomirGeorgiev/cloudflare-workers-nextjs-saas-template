"use client"

import { useState } from "react"
import { renderToMarkdown } from "@tiptap/static-renderer/pm/markdown"
import { Button } from "@/components/tiptap-ui-primitive/button"
import { CopyIcon } from "@/components/tiptap-icons/copy-icon"
import { CheckIcon } from "@/components/tiptap-icons/check-icon"
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"

export function CopyMarkdownButton() {
  const [copied, setCopied] = useState(false)
  const { editor } = useTiptapEditor()

  const handleCopyMarkdown = async () => {
    if (!editor) return

    try {
      const markdown = renderToMarkdown({
        extensions: editor.extensionManager.extensions,
        content: editor.getJSON(),
      })

      await navigator.clipboard.writeText(markdown)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error("Failed to copy markdown:", error)
    }
  }

  return (
    <Button
      type="button"
      data-style="ghost"
      onClick={handleCopyMarkdown}
      disabled={!editor}
      title="Copy as Markdown"
      aria-label="Copy as Markdown"
      role="button"
      tabIndex={-1}
      tooltip="Copy as Markdown"
    >
      {copied ? (
        <CheckIcon className="tiptap-button-icon" />
      ) : (
        <CopyIcon className="tiptap-button-icon" />
      )}
    </Button>
  )
}
