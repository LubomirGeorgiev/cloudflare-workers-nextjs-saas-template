import "server-only";

import {
  getExtensionField,
  type AnyExtension,
  type JSONContent,
  type MarkdownRendererHelpers,
} from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";

import { getTiptapBaseExtensions } from "@/lib/tiptap-base-extensions";

// Tiptap serializes these marks to `==`/`++`, which no Markdown reader understands and
// which collides with prose such as `a == b` or `C++`. Emit the HTML tags instead.
const HTML_MARK_TAGS: Record<string, string | undefined> = {
  highlight: "mark",
  underline: "u",
};

const BACKTICK = "`";
const MIN_FENCE_LENGTH = 3;
const BACKTICK_RUN_PATTERN = /`+/g;

function renderHtmlMark({ tag, node, helpers }: {
  tag: string;
  node: JSONContent;
  helpers: MarkdownRendererHelpers;
}): string {
  return `<${tag}>${helpers.renderChildren(node)}</${tag}>`;
}

/** CommonMark: a fence only holds when it is longer than every backtick run it wraps. */
function fenceForCode(code: string): string {
  let longestRun = 0;

  for (const [run] of code.matchAll(BACKTICK_RUN_PATTERN)) {
    longestRun = Math.max(longestRun, run.length);
  }

  return BACKTICK.repeat(Math.max(MIN_FENCE_LENGTH, longestRun + 1));
}

function renderCodeBlock({ node, helpers }: {
  node: JSONContent;
  helpers: MarkdownRendererHelpers;
}): string {
  const language = (node.attrs?.language as string | null | undefined) || "";

  if (!node.content) {
    const fence = BACKTICK.repeat(MIN_FENCE_LENGTH);

    return `${fence}${language}\n\n${fence}`;
  }

  const code = helpers.renderChildren(node.content);
  const fence = fenceForCode(code);

  return `${fence}${language}\n${code}\n${fence}`;
}

const NODE_MARKDOWN_RENDERERS: Record<
  string,
  ((args: { node: JSONContent; helpers: MarkdownRendererHelpers }) => string) | undefined
> = {
  codeBlock: renderCodeBlock,
};

/**
 * Replace the `==`/`++` mark renderers and the fixed-length code fence. Nested extensions
 * are patched through `addExtensions`, because MarkdownManager flattens the list itself and
 * would otherwise register the pristine children of a kit.
 */
function withMarkdownSerializerOverrides(extension: AnyExtension): AnyExtension {
  const tag = HTML_MARK_TAGS[extension.name];

  if (tag) {
    return extension.extend({
      renderMarkdown: (node: JSONContent, helpers: MarkdownRendererHelpers) =>
        renderHtmlMark({ tag, node, helpers }),
    });
  }

  const renderNode = NODE_MARKDOWN_RENDERERS[extension.name];

  if (renderNode) {
    return extension.extend({
      renderMarkdown: (node: JSONContent, helpers: MarkdownRendererHelpers) =>
        renderNode({ node, helpers }),
    });
  }

  const addExtensions = getExtensionField<() => AnyExtension[]>(extension, "addExtensions", {
    name: extension.name,
    options: extension.options,
    storage: extension.storage,
  });

  if (!addExtensions) {
    return extension;
  }

  return extension.extend({
    addExtensions() {
      return (this.parent?.() ?? []).map(withMarkdownSerializerOverrides);
    },
  });
}

export function renderContentToMarkdown(content: JSONContent): string {
  // Normalize through JSON to strip any leaked ProseMirror node instances before
  // static rendering. This avoids cross-runtime Fragment/Node conversion errors.
  const normalizedContent = JSON.parse(JSON.stringify(content)) as JSONContent;
  const markdownManager = new MarkdownManager({
    extensions: getTiptapBaseExtensions().map(withMarkdownSerializerOverrides),
  })

  return markdownManager.serialize(normalizedContent);
}
