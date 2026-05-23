import type { AnyExtension, Extension } from "@tiptap/core"
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
import bash from "highlight.js/lib/languages/bash"
import css from "highlight.js/lib/languages/css"
import dockerfile from "highlight.js/lib/languages/dockerfile"
import javascript from "highlight.js/lib/languages/javascript"
import json from "highlight.js/lib/languages/json"
import markdown from "highlight.js/lib/languages/markdown"
import python from "highlight.js/lib/languages/python"
import shell from "highlight.js/lib/languages/shell"
import sql from "highlight.js/lib/languages/sql"
import typescript from "highlight.js/lib/languages/typescript"
import xml from "highlight.js/lib/languages/xml"
import yaml from "highlight.js/lib/languages/yaml"
import { createLowlight } from "lowlight"
import { HorizontalRule } from "@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node-extension"
import { AlertBlockExtension } from "@/components/tiptap-node/alert-block/alert-block-extension"

// Shared lowlight instance used across all extensions and renderers
export const sharedLowlight = createLowlight({
  bash,
  css,
  docker: dockerfile,
  html: xml,
  js: javascript,
  jsx: javascript,
  json,
  markdown,
  python,
  shell,
  sql,
  ts: typescript,
  tsx: typescript,
  xml,
  yaml,
})

type LowlightInstance = ReturnType<typeof createLowlight>

interface GetBaseExtensionsOptions {
  lowlight?: LowlightInstance
  alertBlockExtension?: AnyExtension
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
export function getTiptapBaseExtensions({
  lowlight = sharedLowlight,
  alertBlockExtension = AlertBlockExtension,
  starterKitConfig,
}: GetBaseExtensionsOptions = {}): Extension[] {
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
    alertBlockExtension,
  ] as Extension[]
}
