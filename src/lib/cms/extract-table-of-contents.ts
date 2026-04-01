import "server-only";

import type { JSONContent } from "@tiptap/core";

import type { TableOfContentsItem } from "@/lib/cms/table-of-contents-tree";
import { generateSlug } from "@/utils/slugify";

function getNodeText(node: JSONContent | undefined): string {
  if (!node) {
    return "";
  }

  if (typeof node.text === "string") {
    return node.text;
  }

  return (node.content ?? []).map((child) => getNodeText(child)).join("");
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
        const baseId = generateSlug(text) || "section";
        const currentCount = usedIds.get(baseId) ?? 0;
        usedIds.set(baseId, currentCount + 1);

        headings.push({
          id: currentCount > 0 ? `${baseId}-${currentCount + 1}` : baseId,
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
