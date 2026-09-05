import { reportTiptapError, runTiptapCommand } from "@/lib/tiptap-errors"
import { Extension } from '@tiptap/core'
import type { Content, Node } from '@tiptap/core'
import { Fragment } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'

function looksLikeMarkdown(text: string): boolean {
  if (!text) {
    return false
  }

  return (
    /^#{1,6}\s/.test(text) ||
    /\*\*[^*]+\*\*/.test(text) ||
    /\[[^\]]+\]\([^)]+\)/.test(text) ||
    /^[-*+]\s/m.test(text) ||
    /^\d+\.\s/m.test(text) ||
    /^>\s/m.test(text) ||
    /```[\s\S]*?```/.test(text) ||
    /`[^`]+`/.test(text) ||
    /~~[^~]+~~/.test(text) ||
    /^---$/m.test(text) ||
    /!\[[^\]]*\]\([^)]+\)/.test(text)
  )
}

export const PasteMarkdown = Extension.create({
  name: 'pasteMarkdown',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('pasteMarkdown'),
        props: {
          handlePaste: (view, event) => {
            const text = event.clipboardData?.getData('text/plain')

            if (!text || !looksLikeMarkdown(text)) {
              return false
            }

            try {
              const editor = this.editor

              if (editor?.markdown?.parse) {
                const json = editor.markdown.parse(text)
                return runTiptapCommand({
                  id: "markdown-paste",
                  message: "Could not paste Markdown",
                  command: () => editor.commands.insertContent(json as Node | Content | Fragment),
                })
              }
            } catch (error) {
              reportTiptapError({ id: "markdown-paste", message: "Could not paste Markdown", error })
            }

            return false
          },
        },
      }),
    ]
  },
})
