import "server-only";

import type { JSONContent } from "@tiptap/core";
import { renderToMarkdown } from "@tiptap/static-renderer/pm/markdown";

import { getTiptapBaseExtensions } from "@/lib/tiptap-base-extensions";

export function renderContentToMarkdown(content: JSONContent): string {
  return renderToMarkdown({
    extensions: getTiptapBaseExtensions(),
    content,
  });
}
