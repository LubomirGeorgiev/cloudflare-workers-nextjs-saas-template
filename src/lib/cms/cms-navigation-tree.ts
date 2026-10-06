import { CMS_NAVIGATION_NODE_TYPES } from "@/types/cms-navigation";

interface SortableTreeNode<TNode> {
  id: string;
  parentId: string | null;
  sortOrder: number;
  children: TNode[];
}

interface RootPathNode<TNode> {
  nodeType: string;
  resolvedPath: string | null;
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

/** The root path of a navigation: the path of the first page, depth first, whose entry is live. */
export function selectNavigationRootPath<TNode extends RootPathNode<TNode>>({
  nodes,
  isLivePage,
}: {
  nodes: TNode[];
  isLivePage: (node: TNode) => boolean;
}): string | null {
  return findNavigationRootPage({ nodes, isLivePage })?.resolvedPath ?? null;
}

function findNavigationRootPage<TNode extends RootPathNode<TNode>>({
  nodes,
  isLivePage,
}: {
  nodes: TNode[];
  isLivePage: (node: TNode) => boolean;
}): TNode | null {
  for (const node of nodes) {
    if (node.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE && isLivePage(node)) {
      return node;
    }

    const childRoot = findNavigationRootPage({ nodes: node.children, isLivePage });

    if (childRoot) {
      return childRoot;
    }
  }

  return null;
}
