"use client";

import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";

import {
  saveCmsNavigationTreeAction,
  translateNavTitleAction,
} from "@/app/[locale]/(app)/(admin)/admin/_actions/cms-navigation-actions";
import { DEFAULT_LOCALE, ENABLED_LOCALES } from "@/i18n/config";
import { type CmsNavigationKey } from "@/../cms.config";
import { type CmsNavigationTreeResult } from "@/lib/cms/cms-navigation-repository";
import type { CmsCollectionListItem } from "@/lib/cms/entry";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SITE_URL } from "@/constants";
import { CMS_NAVIGATION_NODE_TYPES } from "@/types/cms-navigation";
// Type-only, so it is erased and the picker chunk still loads on the first open.
import type { CmsIconSelection } from "./cms-icon-picker-dialog";
import { CmsNavigationEntryStatusBadge } from "./cms-navigation-row";
import { CmsNavigationNodePanel } from "./cms-navigation-node-panel";
import { CmsNavigationTree } from "./cms-navigation-tree";
import {
  buildEditableTree,
  computeResolvedPaths,
  createTempId,
  findTreeNodeById,
  flattenNavigationTree,
  getDescendantIds,
  getDropTargetData,
  getFlattenedVisibleRows,
  getRootDropTargetData,
  isCmsNavigationRowDragData,
  moveNode,
  moveNodeToRoot,
  removeNode,
  serializeEditableTree,
  toSavedNavigationItems,
  withNodeIcon,
  type CmsNavigationEditorNode,
  type DropPosition,
  type DropTargetState,
  type RootDropPosition,
} from "./cms-navigation-tree-model";

export interface CmsNavigationManagerProps {
  entries: CmsCollectionListItem[];
  initialTree: CmsNavigationTreeResult;
  // locales each linked entry is translated into, keyed by entryId — powers the
  // per-row PAGE coverage flags.
  entryLocalesByEntryId: Record<string, string[]>;
  navigationKey: CmsNavigationKey;
  navigationLabel: string;
  basePath: string;
  collectionLabelSingular: string;
}

// fallow-ignore-next-line unused-export -- Reached by dynamic import from cms-navigation-manager.tsx.
export function CmsNavigationManagerImpl({
  entries,
  initialTree,
  entryLocalesByEntryId,
  navigationKey,
  navigationLabel,
  basePath,
  collectionLabelSingular,
}: CmsNavigationManagerProps) {
  const [items, setItems] = useState<CmsNavigationEditorNode[]>(() =>
    flattenNavigationTree(initialTree)
  );
  const [isAddPageDialogOpen, setIsAddPageDialogOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    initialTree.nodes[0]?.id ?? null
  );
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTargetState | null>(null);
  // The node an in-flight title translation targets — captured at click so the
  // async result merges into the right node even if selection changes.
  const translateTargetNodeIdRef = useRef<string | null>(null);
  const translatableLocales = useMemo(
    () => ENABLED_LOCALES.filter((locale) => locale !== DEFAULT_LOCALE),
    []
  );

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
          // Reflattened from the saved tree, so every preview shows the markup the public site
          // now renders rather than the one the picker handed over.
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
  const rows = useMemo(() => getFlattenedVisibleRows(tree), [tree]);
  const resolvedPaths = useMemo(
    () => computeResolvedPaths({ items, basePath }),
    [basePath, items]
  );
  const selectedNode = useMemo(
    () => items.find((item) => item.id === selectedNodeId) ?? null,
    [items, selectedNodeId]
  );

  const panelResolvedPath = useMemo(() => {
    if (!selectedNode) {
      return null;
    }
    const isPage = selectedNode.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE;
    const groupHasSegment =
      selectedNode.nodeType === CMS_NAVIGATION_NODE_TYPES.GROUP &&
      Boolean(selectedNode.slugSegment);
    if (!isPage && !groupHasSegment) {
      return null;
    }
    return resolvedPaths.get(selectedNode.id) ?? null;
  }, [resolvedPaths, selectedNode]);

  const panelResolvedAbsoluteUrl = useMemo(
    () => (panelResolvedPath ? `${SITE_URL}${panelResolvedPath}` : null),
    [panelResolvedPath]
  );

  // Delete takes the whole subtree, so the confirmation has to name what goes with it.
  const selectedDescendantCount = useMemo(() => {
    const node = selectedNodeId ? findTreeNodeById(tree, selectedNodeId) : null;

    // `getDescendantIds` counts the node itself, which the confirmation names separately.
    return node ? getDescendantIds(node).size - 1 : 0;
  }, [selectedNodeId, tree]);

  const assignedEntryIds = useMemo(
    () => new Set(items.map((item) => item.entryId).filter(Boolean)),
    [items]
  );

  const entryStatusById = useMemo(
    () => new Map(entries.map((entry) => [entry.id, entry.status])),
    [entries]
  );

  // Icons already on the tree, deduped by key. An uploaded icon carries the document it was parsed
  // from, so picking it for a second row attaches the upload there too — the save resolves each
  // row on its own, and a row whose key is not yet stored has to bring its own markup.
  const usedIcons = useMemo(() => {
    const iconsByKey = new Map<string, Omit<CmsIconSelection, "key">>();

    for (const item of items) {
      if (item.icon && item.iconBody) {
        iconsByKey.set(item.icon, {
          icon: item.iconBody,
          svg: item.iconSvg ?? iconsByKey.get(item.icon)?.svg,
        });
      }
    }

    return Array.from(iconsByKey, ([key, used]) => ({ key, ...used }));
  }, [items]);

  const availableEntries = useMemo(
    () =>
      entries.filter(
        (entry) =>
          !assignedEntryIds.has(entry.id) || entry.id === selectedNode?.entryId
      ),
    [assignedEntryIds, entries, selectedNode?.entryId]
  );
  const unassignedEntries = useMemo(
    () => entries.filter((entry) => !assignedEntryIds.has(entry.id)),
    [assignedEntryIds, entries]
  );

  const addGroup = () => {
    const nextNode: CmsNavigationEditorNode = {
      id: createTempId(),
      parentId: null,
      nodeType: CMS_NAVIGATION_NODE_TYPES.GROUP,
      title: "New Group",
      iconBody: null,
      entryId: null,
      slugSegment: null,
      sortOrder: buildEditableTree(items).length,
    };
    const nextItems = [...items, nextNode];

    setItems(nextItems);
    setSelectedNodeId(nextNode.id);
  };

  const addPage = (entry: CmsCollectionListItem) => {
    const nextNode: CmsNavigationEditorNode = {
      id: createTempId(),
      parentId: null,
      nodeType: CMS_NAVIGATION_NODE_TYPES.PAGE,
      title: entry.title,
      iconBody: null,
      entryId: entry.id,
      slugSegment: entry.slug,
      sortOrder: buildEditableTree(items).length,
    };
    const nextItems = [...items, nextNode];

    setItems(nextItems);
    setSelectedNodeId(nextNode.id);
    setIsAddPageDialogOpen(false);
  };

  const updateNode = (
    nodeId: string,
    updater: (node: CmsNavigationEditorNode) => CmsNavigationEditorNode
  ) => {
    setItems((currentItems) =>
      currentItems.map((item) => (item.id === nodeId ? updater(item) : item))
    );
  };

  // The pick writes every icon field onto the node. Only the key and an upload travel to the
  // server, which pins its own copy of the markup.
  const handleIconPicked = ({
    nodeId,
    ...selection
  }: CmsIconSelection & { nodeId: string }) => {
    updateNode(nodeId, (node) => withNodeIcon(node, selection));
  };

  const { execute: translateTitle, isExecuting: isTranslatingTitle } = useAction(
    translateNavTitleAction,
    {
      onError: ({ error }) => {
        toast.error(error.serverError?.message || "Failed to translate title");
      },
      onSuccess: ({ data }) => {
        const nodeId = translateTargetNodeIdRef.current;
        if (!data || !nodeId) {
          return;
        }

        updateNode(nodeId, (node) => ({
          ...node,
          titleTranslations: { ...(node.titleTranslations ?? {}), ...data.translations },
        }));

        if (data.aiTranslated) {
          toast.success("Titles translated with AI");
        } else {
          toast.warning("AI translation unavailable — filled with the source title. Edit manually.");
        }
      },
    }
  );

  const handleTranslateTitle = ({
    nodeId,
    title,
  }: {
    nodeId: string;
    title: string;
  }) => {
    translateTargetNodeIdRef.current = nodeId;
    translateTitle({ title, sourceLocale: DEFAULT_LOCALE });
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
      <CmsNavigationTree
        rows={rows}
        basePath={basePath}
        navigationLabel={navigationLabel}
        draggedId={draggedId}
        dropTarget={dropTarget}
        selectedNodeId={selectedNodeId}
        resolvedPaths={resolvedPaths}
        entryStatusById={entryStatusById}
        entryLocalesByEntryId={entryLocalesByEntryId}
        translatableLocales={translatableLocales}
        unassignedEntryCount={unassignedEntries.length}
        isSaving={isSaving}
        onAddGroup={addGroup}
        onOpenAddPageDialog={() => setIsAddPageDialogOpen(true)}
        onSave={() =>
          saveNavigationTree({
            navigationKey,
            items: toSavedNavigationItems(items),
          })
        }
        onCanDrop={canDropOnRow}
        onSelect={setSelectedNodeId}
        onSetDropTarget={setDropTarget}
      />

      <Dialog open={isAddPageDialogOpen} onOpenChange={setIsAddPageDialogOpen}>
        <DialogContent className="p-0 sm:max-w-xl">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>Add Navigation Page</DialogTitle>
            <DialogDescription>
              Choose which {collectionLabelSingular.toLowerCase()} entry to add to the {navigationLabel.toLowerCase()} tree.
            </DialogDescription>
          </DialogHeader>
          <Command className="rounded-none border-t">
            <CommandInput
              placeholder={`Search ${collectionLabelSingular.toLowerCase()} entries...`}
            />
            <CommandList className="max-h-[420px]">
              <CommandEmpty className="px-6 py-8 text-sm text-muted-foreground">
                {entries.some((entry) => !assignedEntryIds.has(entry.id))
                  ? `No matching ${collectionLabelSingular.toLowerCase()} entries found.`
                  : `Create another ${collectionLabelSingular.toLowerCase()} entry before adding a new navigation page.`}
              </CommandEmpty>
              {unassignedEntries.map((entry) => (
                  <CommandItem
                    key={entry.id}
                    value={`${entry.title} ${entry.slug}`}
                    onSelect={() => addPage(entry)}
                    className="flex items-start justify-between gap-4 px-6 py-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{entry.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        /{entry.slug}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <CmsNavigationEntryStatusBadge status={entry.status} />
                      <span className="text-xs text-muted-foreground">Add page</span>
                    </div>
                  </CommandItem>
                ))}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>

      <CmsNavigationNodePanel
        selectedNode={selectedNode}
        entries={entries}
        availableEntries={availableEntries}
        collectionLabelSingular={collectionLabelSingular}
        translatableLocales={translatableLocales}
        isTranslatingTitle={isTranslatingTitle}
        panelResolvedPath={panelResolvedPath}
        panelResolvedAbsoluteUrl={panelResolvedAbsoluteUrl}
        selectedDescendantCount={selectedDescendantCount}
        usedIcons={usedIcons}
        onUpdateNode={updateNode}
        onTranslateTitle={handleTranslateTitle}
        onPickIcon={handleIconPicked}
        onRemoveSelectedNode={removeSelectedNode}
      />
    </div>
  );
}
