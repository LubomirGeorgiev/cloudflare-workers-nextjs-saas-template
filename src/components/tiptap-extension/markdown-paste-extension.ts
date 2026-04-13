import { Extension } from '@tiptap/core'
import type { Content, Node } from '@tiptap/core'
import { Fragment } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'

function looksLikeMarkdown(text: string): boolean {
  if (!text) return false

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
                editor.commands.insertContent(json as Node | Content | Fragment)
                return true
              }
            } catch (error) {
              console.error('Failed to parse markdown:', error)
            }

            return false
          },
        },
      }),
    ]
  },
})
