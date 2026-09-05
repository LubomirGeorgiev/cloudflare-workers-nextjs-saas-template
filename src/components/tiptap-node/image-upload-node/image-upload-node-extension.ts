import { reportTiptapError } from "@/lib/tiptap-errors"
import { mergeAttributes, Node } from "@tiptap/react"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { ImageUploadNode as ImageUploadNodeComponent } from "@/components/tiptap-node/image-upload-node/image-upload-node"
import type { NodeType } from "@tiptap/pm/model"

// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
export type UploadFunction = (
  file: File,
  onProgress?: (event: { progress: number }) => void,
  abortSignal?: AbortSignal
) => Promise<string>

// oxlint-disable-next-line project/no-unused-module-exports -- Tiptap editor modules intentionally expose composable APIs.
export interface ImageUploadNodeOptions {
  type?: string | NodeType | undefined
  accept?: string
  limit?: number
  maxSize?: number
  upload?: UploadFunction
  onError?: (error: Error) => void
  onSuccess?: (url: string) => void
  // oxlint-disable-next-line typescript/no-explicit-any
  HTMLAttributes: Record<string, any>
}

declare module "@tiptap/react" {
  interface Commands<ReturnType> {
    imageUpload: {
      setImageUploadNode: (options?: ImageUploadNodeOptions) => ReturnType
    }
  }
}

export const ImageUploadNode = Node.create<ImageUploadNodeOptions>({
  name: "imageUpload",

  group: "block",

  draggable: true,

  selectable: true,

  atom: true,

  addOptions() {
    return {
      type: "image",
      accept: "image/*",
      limit: 1,
      maxSize: 0,
      upload: undefined,
      onError: (error) => reportTiptapError({ id: "image-upload-failed", message: "Image upload failed", error }),
      onSuccess: undefined,
      HTMLAttributes: {},
    }
  },

  addAttributes() {
    return {
      accept: {
        default: this.options.accept,
      },
      limit: {
        default: this.options.limit,
      },
      maxSize: {
        default: this.options.maxSize,
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="image-upload"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({ "data-type": "image-upload" }, HTMLAttributes),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageUploadNodeComponent)
  },

  addCommands() {
    return {
      setImageUploadNode:
        (options) =>
          ({ commands }) => {
            return commands.insertContent({
              type: this.name,
              attrs: options,
            })
          },
    }
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { selection } = editor.state
        const { nodeAfter } = selection.$from

        if (
          nodeAfter &&
          nodeAfter.type.name === "imageUpload" &&
          editor.isActive("imageUpload")
        ) {
          const nodeEl = editor.view.nodeDOM(selection.$from.pos)
          if (nodeEl && nodeEl instanceof HTMLElement) {
            // Since NodeViewWrapper is wrapped with a div, we need to click the first child
            const firstChild = nodeEl.firstChild
            if (firstChild && firstChild instanceof HTMLElement) {
              firstChild.click()
              return true
            }
          }
        }
        return false
      },
    }
  },
})

export default ImageUploadNode
