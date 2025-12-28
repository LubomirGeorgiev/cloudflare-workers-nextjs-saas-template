import type { Extension } from "@tiptap/core"
import { StarterKit } from "@tiptap/starter-kit"
import { Image } from "@tiptap/extension-image"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { TextAlign } from "@tiptap/extension-text-align"
import { Typography } from "@tiptap/extension-typography"
import { Highlight } from "@tiptap/extension-highlight"
import { Subscript } from "@tiptap/extension-subscript"
import { Superscript } from "@tiptap/extension-superscript"
import { Table } from "@tiptap/extension-table/table"
import { TableRow } from "@tiptap/extension-table/row"
import { TableCell } from "@tiptap/extension-table/cell"
import { TableHeader } from "@tiptap/extension-table/header"
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight"
import { common, createLowlight } from "lowlight"
import { HorizontalRule } from "@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node-extension"

// Shared lowlight instance used across all extensions and renderers
export const sharedLowlight = createLowlight(common)

type LowlightInstance = ReturnType<typeof createLowlight>

interface GetBaseExtensionsOptions {
  lowlight?: LowlightInstance
  starterKitConfig?: {
    link?: {
      openOnClick?: boolean
      enableClickSelection?: boolean
    }
  }
}

/**
 * Returns the base TipTap extensions configuration shared between editor and static rendering.
 * This ensures consistent rendering across both contexts.
 */
export function getTiptapBaseExtensions({ lowlight = sharedLowlight, starterKitConfig }: GetBaseExtensionsOptions = {}): Extension[] {
  return [
    StarterKit.configure({
      horizontalRule: false, // We use custom HorizontalRule
      codeBlock: false, // We use CodeBlockLowlight instead
      ...(starterKitConfig?.link && {
        link: starterKitConfig.link,
      }),
    }),
    CodeBlockLowlight.configure({
      lowlight,
      enableTabIndentation: true,
      tabSize: 2,
    }),
    HorizontalRule,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Highlight.configure({ multicolor: true }),
    Image,
    Typography,
    Superscript,
    Subscript,
    Table.configure({
      resizable: true,
    }),
    TableRow,
    TableHeader,
    TableCell,
  ] as Extension[]
}
