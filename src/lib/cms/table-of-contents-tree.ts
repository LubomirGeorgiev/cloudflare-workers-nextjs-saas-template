export interface TableOfContentsItem {
  id: string;
  level: number;
  text: string;
}

export interface TableOfContentsNode {
  id: string;
  level: number;
  text: string;
  children: TableOfContentsNode[];
}

/**
 * Builds a nested TOC from a flat heading list (document order).
 * A heading becomes a child of the nearest previous heading with a lower level.
 */
export function buildTableOfContentsTree(
  items: TableOfContentsItem[]
): TableOfContentsNode[] {
  if (items.length === 0) {
    return [];
  }

  const root: TableOfContentsNode = {
    id: "",
    level: 0,
    text: "",
    children: [],
  };
  const stack: TableOfContentsNode[] = [root];

  for (const item of items) {
    const node: TableOfContentsNode = {
      id: item.id,
      level: item.level,
      text: item.text,
      children: [],
    };

    while (stack.length > 1 && stack[stack.length - 1]!.level >= item.level) {
      stack.pop();
    }

    stack[stack.length - 1]!.children.push(node);
    stack.push(node);
  }

  return root.children;
}

export function flattenTableOfContentsIds(nodes: TableOfContentsNode[]): string[] {
  const ids: string[] = [];

  function walk(list: TableOfContentsNode[]) {
    for (const node of list) {
      ids.push(node.id);
      if (node.children.length > 0) {
        walk(node.children);
      }
    }
  }

  walk(nodes);
  return ids;
}
