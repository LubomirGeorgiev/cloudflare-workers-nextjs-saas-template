interface SortableTreeNode<TNode> {
  id: string;
  parentId: string | null;
  sortOrder: number;
  children: TNode[];
}

function sortNavigationSiblings<TNode extends SortableTreeNode<TNode>>(nodes: TNode[]): void {
  nodes.sort((left, right) => left.sortOrder - right.sortOrder);
  nodes.forEach((node) => sortNavigationSiblings(node.children));
}

// Shared by the server repository and the admin navigation editor, which build differently shaped
// nodes from the same flat rows. Pushes each node into its parent's `children` (orphans become
// roots) and sorts every sibling list by `sortOrder`. Mutates the nodes held in `nodeMap`.
export function assembleNavigationTree<TNode extends SortableTreeNode<TNode>>(
  nodeMap: Map<string, TNode>,
): TNode[] {
  const roots: TNode[] = [];

  nodeMap.forEach((node) => {
    if (node.parentId) {
      const parent = nodeMap.get(node.parentId);
      if (parent) {
        parent.children.push(node);
        return;
      }
    }

    roots.push(node);
  });

  sortNavigationSiblings(roots);

  return roots;
}
