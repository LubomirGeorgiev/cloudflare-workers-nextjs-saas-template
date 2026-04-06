"use client";

import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  FolderTree,
  GripVertical,
  Plus,
  Save,
  Trash2,
} from "lucide-react";

import { saveCmsNavigationTreeAction } from "@/app/(admin)/admin/_actions/cms-navigation-actions";
import { type CmsNavigationKey } from "@/../cms.config";
import {
  type CmsNavigationFlatNode,
  type CmsNavigationTreeNode,
} from "@/lib/cms/cms-navigation-repository";
import type { GetCmsCollectionResult } from "@/lib/cms/cms-repository";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SITE_URL } from "@/constants";
import { buildCmsResolvedPath } from "@/lib/cms/cms-paths";
import { cn } from "@/lib/utils";
import { generateSlug } from "@/utils/slugify";
import { CMS_NAVIGATION_NODE_TYPES } from "@/types/cms-navigation";

type DropPosition = "before" | "inside" | "after";
type VisibleCmsNavigationRow = EditableTreeNode & { depth: number };
type RootDropPosition = "start" | "end";

const CMS_NAVIGATION_ROW_DRAG_TYPE = "cms-navigation-row";
const CMS_NAVIGATION_ROOT_DROP_TYPE = "cms-navigation-root-drop";

interface CmsNavigationManagerProps {
  entries: GetCmsCollectionResult[];
  initialTree: CmsNavigationTreeNode[];
  navigationKey: CmsNavigationKey;
  navigationLabel: string;
  basePath: string;
  collectionLabelSingular: string;
}

interface EditableTreeNode extends CmsNavigationFlatNode {
  children: EditableTreeNode[];
}

type CmsNavigationRowDragData = Record<string, unknown> & {
  type: typeof CMS_NAVIGATION_ROW_DRAG_TYPE;
  rowId: string;
};

type CmsNavigationRowDropData = CmsNavigationRowDragData & {
  position: DropPosition;
};

type CmsNavigationRootDropData = Record<string, unknown> & {
  type: typeof CMS_NAVIGATION_ROOT_DROP_TYPE;
  position: RootDropPosition;
};

type DropTargetState =
  | {
      type: "row";
      id: string;
      position: DropPosition;
    }
  | {
      type: "root";
      position: RootDropPosition;
    };

interface CmsNavigationRowProps {
  row: VisibleCmsNavigationRow;
  basePath: string;
  collapsedRowIds: Set<string>;
  dropTarget: DropTargetState | null;
  draggedId: string | null;
  isSelected: boolean;
  resolvedPath: string | null;
  onCanDrop: (args: {
    sourceData: Record<string | symbol, unknown>;
    targetId: string;
  }) => boolean;
  onSelect: (rowId: string) => void;
  onSetDropTarget: (
    target:
      | DropTargetState
      | null
      | ((current: DropTargetState | null) => DropTargetState | null)
  ) => void;
  onToggleCollapsed: (rowId: string) => void;
}

interface CmsNavigationRootDropZoneProps {
  draggedId: string | null;
  isActive: boolean;
  position: RootDropPosition;
  onSetDropTarget: (
    target:
      | DropTargetState
      | null
      | ((current: DropTargetState | null) => DropTargetState | null)
  ) => void;
}

function isCmsNavigationRowDragData(
  data: Record<string | symbol, unknown>
): data is CmsNavigationRowDragData {
  return data.type === CMS_NAVIGATION_ROW_DRAG_TYPE && typeof data.rowId === "string";
}

function getDropPosition({
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

function getDropTargetData(
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

function getRootDropTargetData(
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

function flattenNavigationTree(nodes: CmsNavigationTreeNode[]): CmsNavigationFlatNode[] {
  return nodes.flatMap((node) => [
    {
      id: node.id,
      parentId: node.parentId,
      nodeType: node.nodeType,
      title: node.title,
      entryId: node.entryId ?? null,
      slugSegment: node.slugSegment ?? null,
      sortOrder: node.sortOrder,
    },
    ...flattenNavigationTree(node.children),
  ]);
}

function buildEditableTree(items: CmsNavigationFlatNode[]): EditableTreeNode[] {
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

function serializeEditableTree(
  nodes: EditableTreeNode[],
  parentId: string | null = null
): CmsNavigationFlatNode[] {
  return nodes.flatMap((node, index) => {
    const currentNode: CmsNavigationFlatNode = {
      id: node.id,
      parentId,
      nodeType: node.nodeType,
      title: node.title,
      entryId: node.entryId,
      slugSegment: node.slugSegment,
      sortOrder: index,
    };

    return [currentNode, ...serializeEditableTree(node.children, node.id)];
  });
}

function removeNode(
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

function getDescendantIds(node: EditableTreeNode): Set<string> {
  return node.children.reduce((acc, child) => {
    acc.add(child.id);
    getDescendantIds(child).forEach((id) => acc.add(id));
    return acc;
  }, new Set<string>([node.id]));
}

function findTreeNodeById(
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

function moveNode({
  items,
  draggedId,
  targetId,
  position,
}: {
  items: CmsNavigationFlatNode[];
  draggedId: string;
  targetId: string;
  position: DropPosition;
}): CmsNavigationFlatNode[] {
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

function moveNodeToRoot({
  items,
  draggedId,
  position,
}: {
  items: CmsNavigationFlatNode[];
  draggedId: string;
  position: RootDropPosition;
}): CmsNavigationFlatNode[] {
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

function getFlattenedVisibleRows(
  nodes: EditableTreeNode[],
  collapsedRowIds: Set<string>,
  depth = 0
): Array<EditableTreeNode & { depth: number }> {
  return nodes.flatMap((node) => {
    const currentRow = { ...node, depth };
    const isRowCollapsed = collapsedRowIds.has(node.id);
    const childRows = isRowCollapsed
      ? []
      : getFlattenedVisibleRows(node.children, collapsedRowIds, depth + 1);

    return [currentRow, ...childRows];
  });
}

function computeResolvedPaths({
  items,
  basePath,
}: {
  items: CmsNavigationFlatNode[];
  basePath: string;
}): Map<string, string> {
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const cache = new Map<string, string>();

  const getPath = (item: CmsNavigationFlatNode): string => {
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

function createTempId() {
  return `temp_${crypto.randomUUID()}`;
}

function CmsNavigationRow({
  row,
  basePath,
  collapsedRowIds,
  dropTarget,
  draggedId,
  isSelected,
  resolvedPath,
  onCanDrop,
  onSelect,
  onSetDropTarget,
  onToggleCollapsed,
}: CmsNavigationRowProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const dragHandleRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!rowRef.current) {
      return;
    }

    return combine(
      draggable({
        element: rowRef.current,
        dragHandle: dragHandleRef.current ?? undefined,
        getInitialData: (): CmsNavigationRowDragData => ({
          type: CMS_NAVIGATION_ROW_DRAG_TYPE,
          rowId: row.id,
        }),
      }),
      dropTargetForElements({
        element: rowRef.current,
        canDrop: ({ source }) =>
          onCanDrop({
            sourceData: source.data,
            targetId: row.id,
          }),
        getData: ({ input, element }): CmsNavigationRowDropData => ({
          type: CMS_NAVIGATION_ROW_DRAG_TYPE,
          rowId: row.id,
          position: getDropPosition({ input, element }),
        }),
        onDragEnter: ({ self }) => {
          onSetDropTarget(getDropTargetData(self.data));
        },
        onDrag: ({ self }) => {
          onSetDropTarget(getDropTargetData(self.data));
        },
        onDragLeave: () => {
          onSetDropTarget((current) =>
            current?.type === "row" && current.id === row.id ? null : current
          );
        },
      })
    );
  }, [onCanDrop, onSetDropTarget, row.id]);

  const isDropTarget = dropTarget?.type === "row" && dropTarget.id === row.id;
  const showBeforeIndicator =
    isDropTarget && dropTarget.position === "before";
  const showAfterIndicator =
    isDropTarget && dropTarget.position === "after";
  const showInsideIndicator =
    isDropTarget && dropTarget.position === "inside";

  return (
    <div
      ref={rowRef}
      onClick={() => onSelect(row.id)}
      className={cn(
        "relative flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors",
        isSelected ? "bg-accent" : "hover:bg-muted/50",
        showInsideIndicator && "border-primary bg-primary/10 ring-2 ring-primary/30",
        draggedId === row.id && "opacity-60"
      )}
      style={{ paddingLeft: `${row.depth * 24 + 12}px` }}
    >
      {showBeforeIndicator ? (
        <span className="pointer-events-none absolute inset-x-2 -top-[2px] h-1 rounded-full bg-primary shadow-[0_0_0_1px_hsl(var(--background)),0_0_0_3px_hsl(var(--primary)/0.35)]" />
      ) : null}
      {showAfterIndicator ? (
        <span className="pointer-events-none absolute inset-x-2 -bottom-[2px] h-1 rounded-full bg-primary shadow-[0_0_0_1px_hsl(var(--background)),0_0_0_3px_hsl(var(--primary)/0.35)]" />
      ) : null}
      <span
        ref={dragHandleRef}
        className="flex shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </span>
      <button
        type="button"
        className="shrink-0"
        onClick={(event) => {
          event.stopPropagation();
          onToggleCollapsed(row.id);
        }}
      >
        {row.children.length > 0 ? (
          collapsedRowIds.has(row.id) ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )
        ) : (
          <span className="block h-4 w-4" />
        )}
      </button>
      {row.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE ? (
        <FileText className="h-4 w-4 shrink-0 text-blue-500" />
      ) : (
        <FolderTree className="h-4 w-4 shrink-0 text-amber-500" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{row.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {row.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE
            ? resolvedPath ?? "Page path will be generated after save"
            : row.slugSegment
              ? buildCmsResolvedPath({
                  basePath,
                  segments: [generateSlug(row.slugSegment)],
                })
              : "Group without URL segment"}
        </p>
      </div>
    </div>
  );
}

function CmsNavigationRootDropZone({
  draggedId,
  isActive,
  position,
  onSetDropTarget,
}: CmsNavigationRootDropZoneProps) {
  const dropZoneRef = useRef<HTMLDivElement | null>(null);
  const dragActiveRef = useRef(false);
  const isVisible = draggedId !== null;

  dragActiveRef.current = isVisible;

  useEffect(() => {
    if (!dropZoneRef.current) {
      return;
    }

    return dropTargetForElements({
      element: dropZoneRef.current,
      canDrop: ({ source }) =>
        dragActiveRef.current && isCmsNavigationRowDragData(source.data),
      getData: (): CmsNavigationRootDropData => ({
        type: CMS_NAVIGATION_ROOT_DROP_TYPE,
        position,
      }),
      onDragEnter: ({ self }) => {
        onSetDropTarget(getRootDropTargetData(self.data));
      },
      onDrag: ({ self }) => {
        onSetDropTarget(getRootDropTargetData(self.data));
      },
      onDragLeave: () => {
        onSetDropTarget((current) =>
          current?.type === "root" && current.position === position ? null : current
        );
      },
    });
  }, [onSetDropTarget, position]);

  return (
    <div
      ref={dropZoneRef}
      className={cn(
        "flex h-6 items-center",
        isVisible ? "pointer-events-auto" : "pointer-events-none"
      )}
    >
      <div
        className={cn(
          "flex h-full w-full items-center justify-center rounded-lg border border-dashed text-center text-xs text-muted-foreground",
          "transition-[opacity,transform,border-color,background-color,box-shadow] duration-300 ease-out motion-reduce:transition-none",
          position === "start" ? "origin-top" : "origin-bottom",
          isVisible
            ? "scale-100 border-border px-3 opacity-100"
            : "scale-[0.98] border-transparent px-3 opacity-0",
          isActive && "border-primary bg-primary/10 text-foreground ring-2 ring-primary/30",
          draggedId && !isActive && "border-primary/40"
        )}
      >
        Drop here to move to root level
      </div>
    </div>
  );
}

export function CmsNavigationManager({
  entries,
  initialTree,
  navigationKey,
  navigationLabel,
  basePath,
  collectionLabelSingular,
}: CmsNavigationManagerProps) {
  const [items, setItems] = useState<CmsNavigationFlatNode[]>(
    flattenNavigationTree(initialTree)
  );
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    initialTree[0]?.id ?? null
  );
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTargetState | null>(null);
  const [collapsedRowIds, setCollapsedRowIds] = useState<Set<string>>(() => new Set());

  const { execute: saveNavigationTree, isExecuting: isSaving } = useAction(
    saveCmsNavigationTreeAction,
    {
      onError: ({ error }) => {
        toast.dismiss();
        toast.error(error.serverError?.message || `Failed to save ${navigationLabel.toLowerCase()}`);
      },
      onExecute: () => {
        toast.loading(`Saving ${navigationLabel.toLowerCase()}...`);
      },
      onSuccess: ({ data }) => {
        toast.dismiss();
        toast.success(`${navigationLabel} saved`);

        if (data) {
          const nextItems = flattenNavigationTree(data);
          setItems(nextItems);
          setSelectedNodeId((current) =>
            current && nextItems.some((item) => item.id === current)
              ? current
              : nextItems[0]?.id ?? null
          );
        }
      },
    }
  );

  const tree = useMemo(() => buildEditableTree(items), [items]);
  const rows = useMemo(
    () => getFlattenedVisibleRows(tree, collapsedRowIds),
    [collapsedRowIds, tree]
  );
  const resolvedPaths = useMemo(
    () => computeResolvedPaths({ items, basePath }),
    [basePath, items]
  );
  const selectedNode = useMemo(
    () => items.find((item) => item.id === selectedNodeId) ?? null,
    [items, selectedNodeId]
  );

  const panelResolvedPath = useMemo(() => {
    if (!selectedNode) return null;
    const isPage = selectedNode.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE;
    const groupHasSegment =
      selectedNode.nodeType === CMS_NAVIGATION_NODE_TYPES.GROUP &&
      Boolean(selectedNode.slugSegment);
    if (!isPage && !groupHasSegment) return null;
    return resolvedPaths.get(selectedNode.id) ?? null;
  }, [resolvedPaths, selectedNode]);

  const panelResolvedAbsoluteUrl = useMemo(
    () => (panelResolvedPath ? `${SITE_URL}${panelResolvedPath}` : null),
    [panelResolvedPath]
  );

  const assignedEntryIds = useMemo(
    () => new Set(items.map((item) => item.entryId).filter(Boolean)),
    [items]
  );

  const availableEntries = useMemo(
    () =>
      entries.filter(
        (entry) =>
          !assignedEntryIds.has(entry.id) || entry.id === selectedNode?.entryId
      ),
    [assignedEntryIds, entries, selectedNode?.entryId]
  );

  const addGroup = () => {
    const nextItems = [
      ...items,
      {
        id: createTempId(),
        parentId: null,
        nodeType: CMS_NAVIGATION_NODE_TYPES.GROUP,
        title: "New Group",
        entryId: null,
        slugSegment: null,
        sortOrder: tree.length,
      },
    ];

    setItems(nextItems);
    setSelectedNodeId(nextItems[nextItems.length - 1]?.id ?? null);
  };

  const addPage = () => {
    const firstAvailableEntry = entries.find(
      (entry) => !assignedEntryIds.has(entry.id)
    );

    if (!firstAvailableEntry) {
      toast.error(`Create another ${collectionLabelSingular.toLowerCase()} entry before adding a new navigation page`);
      return;
    }

    const nextItems = [
      ...items,
      {
        id: createTempId(),
        parentId: null,
        nodeType: CMS_NAVIGATION_NODE_TYPES.PAGE,
        title: firstAvailableEntry.title,
        entryId: firstAvailableEntry.id,
        slugSegment: firstAvailableEntry.slug,
        sortOrder: tree.length,
      },
    ];

    setItems(nextItems);
    setSelectedNodeId(nextItems[nextItems.length - 1]?.id ?? null);
  };

  const updateNode = (
    nodeId: string,
    updater: (node: CmsNavigationFlatNode) => CmsNavigationFlatNode
  ) => {
    setItems((currentItems) =>
      currentItems.map((item) => (item.id === nodeId ? updater(item) : item))
    );
  };

  const removeSelectedNode = () => {
    if (!selectedNodeId) {
      return;
    }

    const removableTree = buildEditableTree(items);
    const nextTree = removeNode(removableTree, selectedNodeId).nextNodes;
    const nextItems = serializeEditableTree(nextTree);

    setItems(nextItems);
    setSelectedNodeId(nextItems[0]?.id ?? null);
  };

  const handleDrop = ({
    draggedId,
    targetId,
    position,
  }: {
    draggedId: string;
    targetId: string;
    position: DropPosition;
  }) => {
    if (draggedId === targetId) {
      return;
    }

    setItems((currentItems) =>
      moveNode({
        items: currentItems,
        draggedId,
        targetId,
        position,
      })
    );
    if (position === "inside") {
      setCollapsedRowIds((prev) => {
        const next = new Set(prev);
        next.delete(targetId);
        return next;
      });
    }
    setDraggedId(null);
    setDropTarget(null);
  };

  const handleRootDrop = ({
    draggedId,
    position,
  }: {
    draggedId: string;
    position: RootDropPosition;
  }) => {
    setItems((currentItems) =>
      moveNodeToRoot({
        items: currentItems,
        draggedId,
        position,
      })
    );
    setDraggedId(null);
    setDropTarget(null);
  };

  const canDropOnRow = ({
    sourceData,
    targetId,
  }: {
    sourceData: Record<string | symbol, unknown>;
    targetId: string;
  }) => {
    if (!isCmsNavigationRowDragData(sourceData) || sourceData.rowId === targetId) {
      return false;
    }

    const draggedNode = findTreeNodeById(tree, sourceData.rowId);

    if (!draggedNode) {
      return true;
    }

    return !getDescendantIds(draggedNode).has(targetId);
  };

  useEffect(() => {
    return monitorForElements({
      canMonitor: ({ source }) => isCmsNavigationRowDragData(source.data),
      onDragStart: ({ source }) => {
        if (isCmsNavigationRowDragData(source.data)) {
          setDraggedId(source.data.rowId);
        }
      },
      onDropTargetChange: ({ location }) => {
        if (location.current.dropTargets.length === 0) {
          setDropTarget(null);
        }
      },
      onDrop: ({ source, location }) => {
        if (!isCmsNavigationRowDragData(source.data)) {
          setDraggedId(null);
          setDropTarget(null);
          return;
        }

        const target = location.current.dropTargets
          .map((dropTargetRecord) => {
            const rowTarget = getDropTargetData(dropTargetRecord.data);

            if (rowTarget) {
              return rowTarget;
            }

            return getRootDropTargetData(dropTargetRecord.data);
          })
          .find(Boolean);

        if (!target) {
          setDraggedId(null);
          setDropTarget(null);
          return;
        }

        if (target.type === "root") {
          handleRootDrop({
            draggedId: source.data.rowId,
            position: target.position,
          });
          return;
        }

        handleDrop({
          draggedId: source.data.rowId,
          targetId: target.id,
          position: target.position,
        });
      },
    });
  }, [handleDrop, handleRootDrop]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)]">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-0">
          <div>
            <CardTitle>{navigationLabel} Tree</CardTitle>
            <p className="text-sm text-muted-foreground mt-2">
              Drag rows to reorder or nest them. Drop near the top or bottom for sibling placement, or in the middle to nest under the target.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={addGroup}>
              <Plus className="h-4 w-4 mr-2" />
              Add Group
            </Button>
            <Button variant="outline" onClick={addPage}>
              <Plus className="h-4 w-4 mr-2" />
              Add Page
            </Button>
            <Button
              onClick={() =>
                saveNavigationTree({
                  navigationKey,
                  items,
                })
              }
              disabled={isSaving}
            >
              <Save className="h-4 w-4 mr-2" />
              Save
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              Add a group or a page to start your navigation tree.
            </div>
          ) : (
            <div className="space-y-2">
              <CmsNavigationRootDropZone
                draggedId={draggedId}
                isActive={
                  dropTarget?.type === "root" && dropTarget.position === "start"
                }
                position="start"
                onSetDropTarget={setDropTarget}
              />
              {rows.map((row) => {
                return (
                  <CmsNavigationRow
                    key={row.id}
                    row={row}
                    basePath={basePath}
                    collapsedRowIds={collapsedRowIds}
                    dropTarget={dropTarget}
                    draggedId={draggedId}
                    isSelected={row.id === selectedNodeId}
                    resolvedPath={resolvedPaths.get(row.id) ?? null}
                    onCanDrop={canDropOnRow}
                    onSelect={setSelectedNodeId}
                    onSetDropTarget={setDropTarget}
                    onToggleCollapsed={(rowId) =>
                      setCollapsedRowIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(rowId)) {
                          next.delete(rowId);
                        } else {
                          next.add(rowId);
                        }
                        return next;
                      })
                    }
                  />
                );
              })}
              <CmsNavigationRootDropZone
                draggedId={draggedId}
                isActive={
                  dropTarget?.type === "root" && dropTarget.position === "end"
                }
                position="end"
                onSetDropTarget={setDropTarget}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Selected Item Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {!selectedNode ? (
            <p className="text-sm text-muted-foreground">
              Select a node to edit its metadata.
            </p>
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Title</label>
                <Input
                  value={selectedNode.title}
                  onChange={(event) =>
                    updateNode(selectedNode.id, (node) => ({
                      ...node,
                      title: event.target.value,
                    }))
                  }
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Node Type</label>
                <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
                  {selectedNode.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE ? "Page" : "Group"}
                </div>
              </div>

              {selectedNode.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium">{collectionLabelSingular} Entry</label>
                  <Select
                    value={selectedNode.entryId ?? ""}
                    onValueChange={(entryId) => {
                      const entry = entries.find((candidate) => candidate.id === entryId);

                      updateNode(selectedNode.id, (node) => ({
                        ...node,
                        entryId,
                        title: node.title || entry?.title || node.title,
                        slugSegment: node.slugSegment || entry?.slug || null,
                      }));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={`Select ${collectionLabelSingular.toLowerCase()} entry`} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableEntries.map((entry) => (
                        <SelectItem key={entry.id} value={entry.id}>
                          {entry.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {selectedNode.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE ? "Slug Segment" : "Group URL Segment"}
                </label>
                <Input
                  value={selectedNode.slugSegment ?? ""}
                  onChange={(event) =>
                    updateNode(selectedNode.id, (node) => ({
                      ...node,
                      slugSegment: event.target.value,
                    }))
                  }
                  placeholder={
                    selectedNode.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE
                      ? "getting-started"
                      : "guides"
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {selectedNode.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE
                    ? "This is the local URL segment used when the full path is derived from the tree."
                    : "Leave blank if this group should organize pages without contributing to the URL."}
                </p>
              </div>

              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="font-medium">Public URL</p>
                <p className="mt-1 text-muted-foreground">
                  {panelResolvedAbsoluteUrl ? (
                    <a
                      href={panelResolvedAbsoluteUrl}
                      target="_blank"
                      className="break-all font-medium text-primary underline underline-offset-4"
                    >
                      {panelResolvedAbsoluteUrl}
                    </a>
                  ) : selectedNode.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE ? (
                    "Save to generate the canonical path."
                  ) : (
                    "This group does not currently add a URL segment."
                  )}
                </p>
              </div>

              <Button
                type="button"
                variant="destructive"
                onClick={removeSelectedNode}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Node
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
