import { Node } from "@tiptap/core"
import type { MarkdownToken } from "@tiptap/core"

import {
  ALERT_BLOCK_NODE_NAME,
  DEFAULT_ALERT_BLOCK_BODY,
  DEFAULT_ALERT_BLOCK_TITLE,
  DEFAULT_ALERT_BLOCK_VARIANT,
  type AlertBlockAttrs,
  normalizeAlertBlockVariant,
} from "@/components/tiptap-node/alert-block/alert-block-types"

import { alertBlockDomSpec } from "./alert-block"

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    alertBlock: {
      setAlertBlock: (attrs?: AlertBlockAttrs) => ReturnType
    }
  }
}

interface AlertMarkdownToken extends MarkdownToken {
  body?: string
}

interface NormalizedAlertMarkdownAttrs {
  title: string
  body: string
  variant: string
}

function normalizeMarkdownText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim()
}

function getNormalizedAlertMarkdownAttrs(attrs?: Record<string, unknown>): NormalizedAlertMarkdownAttrs {
  const variant = normalizeAlertBlockVariant(attrs?.variant)

  return {
    title:
      typeof attrs?.title === "string" ? normalizeMarkdownText(attrs.title) : "",
    body:
      typeof attrs?.body === "string" ? normalizeMarkdownText(attrs.body) : "",
    variant: variant.toUpperCase(),
  }
}

function shouldRenderCustomTitle(title: string): boolean {
  const normalizedTitle = title.trim()

  return normalizedTitle.length > 0 && normalizedTitle !== DEFAULT_ALERT_BLOCK_TITLE
}

function prefixBlockquoteLines(lines: string[]): string {
  return lines.map((line) => (line.length > 0 ? `> ${line}` : ">")).join("\n")
}

function extractAlertTitleAndBody(body: string): Pick<AlertBlockAttrs, "title" | "body"> {
  const normalizedBody = normalizeMarkdownText(body)

  if (!normalizedBody) {
    return {}
  }

  const lines = normalizedBody.split("\n")
  const firstContentLineIndex = lines.findIndex((line) => line.trim().length > 0)

  if (firstContentLineIndex === -1) {
    return {}
  }

  const titleMatch = lines[firstContentLineIndex]?.trim().match(/^\*\*(.+?)\*\*$/)

  if (!titleMatch) {
    return { body: normalizedBody }
  }

  const remainingLines = [...lines]
  remainingLines.splice(firstContentLineIndex, 1)

  if (remainingLines[firstContentLineIndex]?.trim() === "") {
    remainingLines.splice(firstContentLineIndex, 1)
  }

  return {
    title: titleMatch[1]?.trim(),
    body: normalizeMarkdownText(remainingLines.join("\n")),
  }
}

function parseAlertTokenBody(raw: string): string {
  const lines = raw.replace(/\r\n/g, "\n").split("\n")
  const bodyLines = lines.slice(1).map((line) => line.replace(/^>\s?/, ""))

  return bodyLines.join("\n")
}

function parseAlertTokenVariant(raw?: string): AlertBlockAttrs["variant"] {
  const variantMatch = raw?.match(/^> \[!([A-Z]+)\]/)

  return normalizeAlertBlockVariant(variantMatch?.[1])
}

export const AlertBlockExtension = Node.create({
  name: ALERT_BLOCK_NODE_NAME,

  markdownTokenName: ALERT_BLOCK_NODE_NAME,

  group: "block",

  atom: true,

  selectable: true,

  draggable: true,

  addAttributes() {
    return {
      title: {
        default: DEFAULT_ALERT_BLOCK_TITLE,
        rendered: false,
        parseHTML: (element) => element.querySelector("[data-alert-title]")?.textContent ?? element.getAttribute("title") ?? "",
      },
      body: {
        default: DEFAULT_ALERT_BLOCK_BODY,
        rendered: false,
        parseHTML: (element) => element.querySelector("[data-alert-body]")?.textContent ?? element.getAttribute("body") ?? "",
      },
      variant: {
        default: DEFAULT_ALERT_BLOCK_VARIANT,
        rendered: false,
        parseHTML: (element) => normalizeAlertBlockVariant(element.getAttribute("data-variant") ?? element.getAttribute("variant")),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="alert-block"]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return alertBlockDomSpec({ attrs: node.attrs, HTMLAttributes, editable: false, target: "html" })
  },

  markdownTokenizer: {
    name: ALERT_BLOCK_NODE_NAME,
    level: "block",
    start: (src) => src.indexOf("> [!"),
    tokenize(src) {
      const alertHeaderMatch = src.match(/^> \[![A-Z]+\][^\n]*(?:\n|$)/)

      if (!alertHeaderMatch) {
        return undefined
      }

      const lines = src.replace(/\r\n/g, "\n").split("\n")
      const rawLines: string[] = []

      for (const line of lines) {
        if (rawLines.length === 0) {
          rawLines.push(line)
          continue
        }

        if (!/^>\s?/.test(line)) {
          break
        }

        rawLines.push(line)
      }

      const raw = rawLines.join("\n")

      return {
        type: ALERT_BLOCK_NODE_NAME,
        raw,
        body: parseAlertTokenBody(raw),
      }
    },
  },

  parseMarkdown(token) {
    const alertToken = token as AlertMarkdownToken
    const parsedContent = extractAlertTitleAndBody(alertToken.body ?? "")

    return {
      type: this.name,
      attrs: {
        title: parsedContent.title ?? DEFAULT_ALERT_BLOCK_TITLE,
        body: parsedContent.body ?? "",
        variant: parseAlertTokenVariant(alertToken.raw),
      } satisfies AlertBlockAttrs,
    }
  },

  renderMarkdown(node) {
    const { title, body, variant } = getNormalizedAlertMarkdownAttrs(node.attrs)
    const lines = [`[!${variant}]`]

    if (shouldRenderCustomTitle(title)) {
      lines.push(`**${title}**`)
    }

    if (body) {
      lines.push(...body.split("\n"))
    }

    return `${prefixBlockquoteLines(lines)}\n`
  },

  addCommands() {
    return {
      setAlertBlock:
        (attrs = {}) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs,
          })
        },
    }
  },
})
