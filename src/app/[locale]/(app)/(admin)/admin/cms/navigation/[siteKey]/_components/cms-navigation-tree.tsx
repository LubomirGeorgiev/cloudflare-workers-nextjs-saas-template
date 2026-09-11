"use client";

import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { useEffect, useRef } from "react";
import { Plus, Save } from "lucide-react";

import { type Locale } from "@/i18n/config";
import type { CmsCollectionListItem } from "@/lib/cms/entry";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CmsNavigationRow } from "./cms-navigation-row";
import {
  CMS_NAVIGATION_ROOT_DROP_TYPE,
  getRootDropTargetData,
  getRowTranslatedLocales,
  isCmsNavigationRowDragData,
  type CmsNavigationRootDropData,
  type DropTargetState,
  type RootDropPosition,
  type SetDropTarget,
  type VisibleCmsNavigationRow,
} from "./cms-navigation-tree-model";

interface CmsNavigationRootDropZoneProps {
  draggedId: string | null;
  isActive: boolean;
  position: RootDropPosition;
  onSetDropTarget: SetDropTarget;
}

interface CmsNavigationTreeProps {
  rows: VisibleCmsNavigationRow[];
  basePath: string;
  navigationLabel: string;
  draggedId: string | null;
  dropTarget: DropTargetState | null;
  selectedNodeId: string | null;
  resolvedPaths: Map<string, string>;
  entryStatusById: Map<string, CmsCollectionListItem["status"]>;
  entryLocalesByEntryId: Record<string, string[]>;
  translatableLocales: Locale[];
  unassignedEntryCount: number;
  isSaving: boolean;
  onAddGroup: () => void;
  onOpenAddPageDialog: () => void;
  onSave: () => void;
  onCanDrop: (args: {
    sourceData: Record<string | symbol, unknown>;
    targetId: string;
  }) => boolean;
  onSelect: (rowId: string) => void;
  onSetDropTarget: SetDropTarget;
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

export function CmsNavigationTree({
  rows,
  basePath,
  navigationLabel,
  draggedId,
  dropTarget,
  selectedNodeId,
  resolvedPaths,
  entryStatusById,
  entryLocalesByEntryId,
  translatableLocales,
  unassignedEntryCount,
  isSaving,
  onAddGroup,
  onOpenAddPageDialog,
  onSave,
  onCanDrop,
  onSelect,
  onSetDropTarget,
}: CmsNavigationTreeProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-0">
        <div>
          <CardTitle>{navigationLabel} Tree</CardTitle>
          <p className="text-sm text-muted-foreground mt-2">
            Drag rows to reorder or nest them. Drop near the top or bottom for sibling placement, or in the middle to nest under the target.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onAddGroup}>
            <Plus className="h-4 w-4 mr-2" />
            Add Group
          </Button>
          <Button
            variant="outline"
            onClick={onOpenAddPageDialog}
            className="relative"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Page
            {unassignedEntryCount > 0 ? (
              <span className="absolute -right-2 -top-2 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold leading-none text-white shadow-sm">
                {unassignedEntryCount}
              </span>
            ) : null}
          </Button>
          <Button onClick={onSave} disabled={isSaving}>
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
              onSetDropTarget={onSetDropTarget}
            />
            {rows.map((row) => {
              return (
                <CmsNavigationRow
                  key={row.id}
                  row={row}
                  basePath={basePath}
                  dropTarget={dropTarget}
                  draggedId={draggedId}
                  isSelected={row.id === selectedNodeId}
                  resolvedPath={resolvedPaths.get(row.id) ?? null}
                  entryStatus={row.entryId ? entryStatusById.get(row.entryId) ?? null : null}
                  iconBody={row.iconBody}
                  translatableLocales={translatableLocales}
                  translatedLocales={getRowTranslatedLocales({
                    node: row,
                    entryLocalesByEntryId,
                  })}
                  onCanDrop={onCanDrop}
                  onSelect={onSelect}
                  onSetDropTarget={onSetDropTarget}
                />
              );
            })}
            <CmsNavigationRootDropZone
              draggedId={draggedId}
              isActive={
                dropTarget?.type === "root" && dropTarget.position === "end"
              }
              position="end"
              onSetDropTarget={onSetDropTarget}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
