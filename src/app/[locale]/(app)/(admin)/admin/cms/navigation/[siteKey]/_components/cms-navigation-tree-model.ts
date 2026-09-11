import {
  DEFAULT_LOCALE,
  ENABLED_LOCALES,
  type Locale,
} from "@/i18n/config";
import {
  type CmsNavigationFlatNode,
  type CmsNavigationSaveNode,
  type CmsNavigationTreeNode,
} from "@/lib/cms/cms-navigation-repository";
// Type-only, so it is erased and the picker chunk still loads on the first open.
import type { CmsIconSelection } from "./cms-icon-picker-dialog";
import type { CmsIconBody, CmsIconBodyByKey } from "@/types/cms-navigation";
import { buildCmsResolvedPath } from "@/lib/cms/cms-paths";
import { generateSlug } from "@/utils/slugify";

export const CMS_NAVIGATION_ROW_DRAG_TYPE = "cms-navigation-row";
export const CMS_NAVIGATION_ROOT_DROP_TYPE = "cms-navigation-root-drop";

export type DropPosition = "before" | "inside" | "after";
export type RootDropPosition = "start" | "end";
export type VisibleCmsNavigationRow = EditableTreeNode & { depth: number };

/**
 * A flat node plus the two icon fields the editor needs and the table does not hold: the markup
 * that previews the icon, and the uploaded document behind a `custom:` key. `toSavedNavigationItems`
 * drops the preview; only `iconSvg` travels on, and only until the save stores a body for the key.
 *
 * The three icon fields move as one — see `withNodeIcon`.
 */
export interface CmsNavigationEditorNode extends CmsNavigationFlatNode {
  iconBody: CmsIconBody | null;
  iconSvg?: string | null;
}

/**
 * Sets or clears all three icon fields together. A key with no body draws nothing, and a body or an
 * upload left behind by a cleared key keeps every preview drawing an icon the save will not store,
 * so pick and remove both go through here rather than writing the fields they each care about.
 */
export function withNodeIcon(
  node: CmsNavigationEditorNode,
  selection: CmsIconSelection | null
): CmsNavigationEditorNode {
  return {
    ...node,
    icon: selection?.key ?? null,
    iconBody: selection?.icon ?? null,
    iconSvg: selection?.svg ?? null,
  };
}

interface EditableTreeNode extends CmsNavigationEditorNode {
  children: EditableTreeNode[];
}

export type CmsNavigationRowDragData = Record<string, unknown> & {
  type: typeof CMS_NAVIGATION_ROW_DRAG_TYPE;
  rowId: string;
};

export type CmsNavigationRowDropData = CmsNavigationRowDragData & {
  position: DropPosition;
};

export type CmsNavigationRootDropData = Record<string, unknown> & {
  type: typeof CMS_NAVIGATION_ROOT_DROP_TYPE;
  position: RootDropPosition;
};

export type DropTargetState =
  | {
      type: "row";
      id: string;
      position: DropPosition;
    }
  | {
      type: "root";
      position: RootDropPosition;
    };

export type SetDropTarget = (
  target:
    | DropTargetState
    | null
    | ((current: DropTargetState | null) => DropTargetState | null)
) => void;

// The locales a node resolves a translated title in: a PAGE node borrows its
// linked entry's translations; any node's explicit `titleTranslations` override
// counts too. Drives the at-a-glance row coverage flags.
export function getRowTranslatedLocales({
  node,
  entryLocalesByEntryId,
}: {
  node: CmsNavigationEditorNode;
  entryLocalesByEntryId: Record<string, string[]>;
}): Set<Locale> {
  const translated = new Set<Locale>([DEFAULT_LOCALE]);

  if (node.entryId) {
    for (const locale of entryLocalesByEntryId[node.entryId] ?? []) {
      if (ENABLED_LOCALES.includes(locale as Locale)) {
        translated.add(locale as Locale);
      }
    }
  }

  if (node.titleTranslations) {
    for (const [locale, value] of Object.entries(node.titleTranslations)) {
      if (value?.trim() && ENABLED_LOCALES.includes(locale as Locale)) {
        translated.add(locale as Locale);
      }
    }
  }

  return translated;
}

export function isCmsNavigationRowDragData(
  data: Record<string | symbol, unknown>
): data is CmsNavigationRowDragData {
  return data.type === CMS_NAVIGATION_ROW_DRAG_TYPE && typeof data.rowId === "string";
}

export function getDropPosition({
  input,
  element,
}: {
  input: { clientY: number };
  element: Element;
}): DropPosition {
  const bounds = element.getBoundingClientRect();
  const offsetY = input.clientY - bounds.top;

  if (offsetY < bounds.height / 3) {
    return "before";
  }

  if (offsetY > (bounds.height * 2) / 3) {
    return "after";
  }

  return "inside";
}

export function getDropTargetData(
  data: Record<string | symbol, unknown>
): DropTargetState | null {
  if (
    data.type !== CMS_NAVIGATION_ROW_DRAG_TYPE ||
    typeof data.rowId !== "string" ||
    (data.position !== "before" &&
      data.position !== "inside" &&
      data.position !== "after")
  ) {
    return null;
  }

  return {
    type: "row",
    id: data.rowId,
    position: data.position,
  };
}

export function getRootDropTargetData(
  data: Record<string | symbol, unknown>
): DropTargetState | null {
  if (
    data.type !== CMS_NAVIGATION_ROOT_DROP_TYPE ||
    (data.position !== "start" && data.position !== "end")
  ) {
    return null;
  }

  return {
    type: "root",
    position: data.position,
  };
}

export function flattenNavigationTree({
  nodes,
  iconBodyByKey,
}: {
  nodes: CmsNavigationTreeNode[];
  iconBodyByKey: CmsIconBodyByKey;
}): CmsNavigationEditorNode[] {
  return nodes.flatMap((node) => [
    {
      id: node.id,
      parentId: node.parentId,
      nodeType: node.nodeType,
      title: node.title,
      titleTranslations: node.titleTranslations ?? null,
      icon: node.icon ?? null,
      iconBody: (node.icon ? iconBodyByKey[node.icon] : null) ?? null,
      // A loaded node's markup is already stored, so it never re-sends the uploaded document.
      iconSvg: null,
      iconColor: node.iconColor ?? null,
      entryId: node.entryId ?? null,
      slugSegment: node.slugSegment ?? null,
      sortOrder: node.sortOrder,
    },
    ...flattenNavigationTree({ nodes: node.children, iconBodyByKey }),
  ]);
}

// The save payload: the same nodes without the preview markup, which the server never reads and
// would otherwise send a full tree's worth of SVG back over the wire.
export function toSavedNavigationItems(
  items: CmsNavigationEditorNode[]
): CmsNavigationSaveNode[] {
  return items.map(({ iconBody: __iconBody, ...item }) => item);
}

export function buildEditableTree(items: CmsNavigationEditorNode[]): EditableTreeNode[] {
  const nodeMap = new Map<string, EditableTreeNode>(
    items.map((item) => [item.id, { ...item, children: [] }])
  );
  const roots: EditableTreeNode[] = [];

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

  const sortNodes = (nodesToSort: EditableTreeNode[]) => {
    nodesToSort.sort((left, right) => left.sortOrder - right.sortOrder);
    nodesToSort.forEach((node) => sortNodes(node.children));
  };

  sortNodes(roots);

  return roots;
}

export function serializeEditableTree(
  nodes: EditableTreeNode[],
  parentId: string | null = null
): CmsNavigationEditorNode[] {
  return nodes.flatMap((node, index) => {
    const currentNode: CmsNavigationEditorNode = {
      id: node.id,
      parentId,
      nodeType: node.nodeType,
      title: node.title,
      titleTranslations: node.titleTranslations ?? null,
      icon: node.icon ?? null,
      iconBody: node.iconBody ?? null,
      iconSvg: node.iconSvg ?? null,
      iconColor: node.iconColor ?? null,
      entryId: node.entryId,
      slugSegment: node.slugSegment,
      sortOrder: index,
    };

    return [currentNode, ...serializeEditableTree(node.children, node.id)];
  });
}

export function removeNode(
  nodes: EditableTreeNode[],
  nodeId: string
): {
  nextNodes: EditableTreeNode[];
  removedNode: EditableTreeNode | null;
} {
  let removedNode: EditableTreeNode | null = null;

  const nextNodes = nodes
    .filter((node) => {
      if (node.id === nodeId) {
        removedNode = node;
        return false;
      }

      return true;
    })
    .map((node) => {
      if (removedNode) {
        return node;
      }

      const childResult = removeNode(node.children, nodeId);
      if (childResult.removedNode) {
        removedNode = childResult.removedNode;
        return {
          ...node,
          children: childResult.nextNodes,
        };
      }

      return node;
    });

  return { nextNodes, removedNode };
}

function insertNode(
  nodes: EditableTreeNode[],
  targetId: string,
  position: DropPosition,
  nodeToInsert: EditableTreeNode
): EditableTreeNode[] {
  const targetIndex = nodes.findIndex((node) => node.id === targetId);

  if (targetIndex >= 0) {
    if (position === "inside") {
      return nodes.map((node) =>
        node.id === targetId
          ? {
              ...node,
              children: [...node.children, nodeToInsert],
            }
          : node
      );
    }

    const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
    return [
      ...nodes.slice(0, insertIndex),
      nodeToInsert,
      ...nodes.slice(insertIndex),
    ];
  }

  return nodes.map((node) => ({
    ...node,
    children: insertNode(node.children, targetId, position, nodeToInsert),
  }));
}

export function getDescendantIds(node: EditableTreeNode): Set<string> {
  return node.children.reduce((acc, child) => {
    acc.add(child.id);
    getDescendantIds(child).forEach((id) => acc.add(id));
    return acc;
  }, new Set<string>([node.id]));
}

export function findTreeNodeById(
  nodes: EditableTreeNode[],
  nodeId: string
): EditableTreeNode | null {
  for (const node of nodes) {
    if (node.id === nodeId) {
      return node;
    }

    const matchingChild = findTreeNodeById(node.children, nodeId);
    if (matchingChild) {
      return matchingChild;
    }
  }

  return null;
}

export function moveNode({
  items,
  draggedId,
  targetId,
  position,
}: {
  items: CmsNavigationEditorNode[];
  draggedId: string;
  targetId: string;
  position: DropPosition;
}): CmsNavigationEditorNode[] {
  const tree = buildEditableTree(items);
  const removedResult = removeNode(tree, draggedId);

  if (!removedResult.removedNode) {
    return items;
  }

  const descendantIds = getDescendantIds(removedResult.removedNode);
  if (descendantIds.has(targetId)) {
    return items;
  }

  const nextTree = insertNode(
    removedResult.nextNodes,
    targetId,
    position,
    removedResult.removedNode
  );

  return serializeEditableTree(nextTree);
}

export function moveNodeToRoot({
  items,
  draggedId,
  position,
}: {
  items: CmsNavigationEditorNode[];
  draggedId: string;
  position: RootDropPosition;
}): CmsNavigationEditorNode[] {
  const tree = buildEditableTree(items);
  const removedResult = removeNode(tree, draggedId);

  if (!removedResult.removedNode) {
    return items;
  }

  const nextRoots =
    position === "start"
      ? [removedResult.removedNode, ...removedResult.nextNodes]
      : [...removedResult.nextNodes, removedResult.removedNode];

  return serializeEditableTree(nextRoots);
}

export function getFlattenedVisibleRows(
  nodes: EditableTreeNode[],
  depth = 0
): Array<EditableTreeNode & { depth: number }> {
  return nodes.flatMap((node) => {
    const currentRow = { ...node, depth };
    const childRows = getFlattenedVisibleRows(node.children, depth + 1);
    return [currentRow, ...childRows];
  });
}

export function computeResolvedPaths({
  items,
  basePath,
}: {
  items: CmsNavigationEditorNode[];
  basePath: string;
}): Map<string, string> {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const cache = new Map<string, string>();

  const getPath = (item: CmsNavigationEditorNode): string => {
    if (cache.has(item.id)) {
      return cache.get(item.id) ?? "";
    }

    const normalizedSegment = item.slugSegment ? generateSlug(item.slugSegment) : "";
    const parentPath = item.parentId ? getPath(itemsById.get(item.parentId)!) : "";
    const path = normalizedSegment
      ? `${parentPath}/${normalizedSegment}`.replace(/\/{2,}/g, "/")
      : parentPath || "";

    cache.set(item.id, path);
    return path;
  };

  items.forEach((item) => {
    getPath(item);
  });

  return new Map(
    Array.from(cache.entries()).map(([id, path]) => [
      id,
      buildCmsResolvedPath({
        basePath,
        segments: [path],
      }),
    ])
  );
}

export function createTempId() {
  return `temp_${crypto.randomUUID()}`;
}
