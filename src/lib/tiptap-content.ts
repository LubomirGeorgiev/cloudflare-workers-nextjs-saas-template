import type { JSONContent } from "@tiptap/core"

// The `doc` node requires `block+`, so `{ type: "doc", content: [] }` fails the
// editor content check with `Invalid content for node doc`. Never hand-write an
// empty document; take it from here.
export const EMPTY_TIPTAP_DOC: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
}

function isEmptyTiptapDoc(content: unknown): boolean {
  if (typeof content !== "object" || content === null) {
    return true
  }

  const { content: children } = content as JSONContent

  return !Array.isArray(children) || children.length === 0
}

// Entries saved before the fix hold an empty document, so normalize on read too.
export function toEditableTiptapDoc(content: unknown): JSONContent {
  if (isEmptyTiptapDoc(content)) {
    return EMPTY_TIPTAP_DOC
  }

  return content as JSONContent
}
