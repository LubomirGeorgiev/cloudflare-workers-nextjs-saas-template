import "server-only";

import type { JSONContent } from "@tiptap/core";

import type { TableOfContentsItem } from "@/lib/cms/table-of-contents-tree";
import { generateSlug } from "@/utils/slugify";

export function getNodeText(node: JSONContent | undefined): string {
  if (!node) {
    return "";
  }

  if (typeof node.text === "string") {
    return node.text;
  }

  return (node.content ?? []).map((child) => getNodeText(child)).join("");
}

// The renderer stamps ids while walking the same tree, so both walks must derive
// them the same way: identical heading text must yield the identical id.
export function nextHeadingId({ usedIds, text }: {
  usedIds: Map<string, number>;
  text: string;
}): string {
  const baseId = generateSlug(text) || "section";
  const currentCount = usedIds.get(baseId) ?? 0;
  usedIds.set(baseId, currentCount + 1);

  return currentCount > 0 ? `${baseId}-${currentCount + 1}` : baseId;
}

export function extractTableOfContents(content: JSONContent): TableOfContentsItem[] {
  const usedIds = new Map<string, number>();
  const headings: TableOfContentsItem[] = [];

  const visit = (node: JSONContent | undefined) => {
    if (!node) {
      return;
    }

    if (node.type === "heading") {
      const text = getNodeText(node).trim();
      const level = typeof node.attrs?.level === "number" ? node.attrs.level : 2;

      if (text) {
        headings.push({
          id: nextHeadingId({ usedIds, text }),
          level,
          text,
        });
      }
    }

    (node.content ?? []).forEach((child) => visit(child));
  };

  visit(content);

  return headings;
}
