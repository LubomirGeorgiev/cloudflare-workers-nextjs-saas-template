import "server-only";

import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";

import { getTiptapBaseExtensions } from "@/lib/tiptap-base-extensions";

export function renderContentToMarkdown(content: JSONContent): string {
  // Normalize through JSON to strip any leaked ProseMirror node instances before
  // static rendering. This avoids cross-runtime Fragment/Node conversion errors.
  const normalizedContent = JSON.parse(JSON.stringify(content)) as JSONContent;
  const markdownManager = new MarkdownManager({
    extensions: getTiptapBaseExtensions(),
  })

  return markdownManager.serialize(normalizedContent)
}
