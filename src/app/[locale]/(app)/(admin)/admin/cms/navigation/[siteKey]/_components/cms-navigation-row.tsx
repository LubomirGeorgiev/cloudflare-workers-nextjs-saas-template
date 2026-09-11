"use client";

import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  draggable,
  dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { useEffect, useRef } from "react";
import { GripVertical } from "lucide-react";

import { type Locale } from "@/i18n/config";
import { buildCmsResolvedPath } from "@/lib/cms/cms-paths";
import { cn } from "@/lib/utils";
import { generateSlug } from "@/utils/slugify";
import { CMS_NAVIGATION_NODE_TYPES, type CmsIconBody } from "@/types/cms-navigation";
import { CmsNavigationNodeIcon } from "@/components/cms-navigation-node-icon";
import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getStatusConfig } from "@/lib/cms/cms-entry-status-config";
import { CmsEntryStatusBadge } from "../../../_components/cms-entry-status-badge";
import { LocaleCoverageBadges } from "../../../_components/locale-coverage-badges";
import {
  CMS_NAVIGATION_ROW_DRAG_TYPE,
  getDropPosition,
  getDropTargetData,
  type CmsNavigationRowDragData,
  type CmsNavigationRowDropData,
  type DropTargetState,
  type SetDropTarget,
  type VisibleCmsNavigationRow,
} from "./cms-navigation-tree-model";

const CMS_NAVIGATION_TREE_INDENT_PX = 24;
const HIDDEN_FROM_PUBLIC_NAV_HINT = "not shown in the public navigation until published";

interface CmsNavigationRowProps {
  row: VisibleCmsNavigationRow;
  basePath: string;
  dropTarget: DropTargetState | null;
  draggedId: string | null;
  isSelected: boolean;
  resolvedPath: string | null;
  /** Status of the linked entry; null for groups and for pages whose entry is not loaded. */
  entryStatus: string | null;
  /** Markup of the row's chosen icon; null until it is picked or the save pins it. */
  iconBody: CmsIconBody | null;
  // Keep row coverage hidden in single-locale mode; the badges render all enabled locales.
  translatableLocales: Locale[];
  translatedLocales: Set<Locale>;
  onCanDrop: (args: {
    sourceData: Record<string | symbol, unknown>;
    targetId: string;
  }) => boolean;
  onSelect: (rowId: string) => void;
  onSetDropTarget: SetDropTarget;
}

// The public tree is queried with status=published and prunes page nodes whose entry is missing, so
// a non-published entry silently disappears from the site while still sitting in this editor.
export function CmsNavigationEntryStatusBadge({ status }: { status: string | null }) {
  if (!status || status === CMS_ENTRY_STATUS.PUBLISHED) {
    return null;
  }

  return (
    <CmsEntryStatusBadge
      status={status}
      className="shrink-0"
      title={`${getStatusConfig(status)?.label ?? status} — ${HIDDEN_FROM_PUBLIC_NAV_HINT}`}
    />
  );
}

export function CmsNavigationRow({
  row,
  basePath,
  dropTarget,
  draggedId,
  isSelected,
  resolvedPath,
  entryStatus,
  iconBody,
  translatableLocales,
  translatedLocales,
  onCanDrop,
  onSelect,
  onSetDropTarget,
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
      className="w-full min-w-0"
      style={{ paddingLeft: row.depth * CMS_NAVIGATION_TREE_INDENT_PX }}
    >
      <div
        ref={rowRef}
        onClick={() => onSelect(row.id)}
        className={cn(
          "relative flex w-full min-w-0 items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors",
          isSelected ? "bg-accent" : "hover:bg-muted/50",
          showInsideIndicator && "border-primary bg-primary/10 ring-2 ring-primary/30",
          draggedId === row.id && "opacity-60"
        )}
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
      {/* Same renderer as the public navigation, so the editor cannot preview a different icon. */}
      <CmsNavigationNodeIcon
        iconBody={iconBody}
        nodeType={row.nodeType}
        iconColor={row.iconColor}
        className="h-4 w-4 shrink-0"
      />
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
      <CmsNavigationEntryStatusBadge status={entryStatus} />
      {translatableLocales.length > 0 ? (
        <LocaleCoverageBadges
          translatedLocales={translatedLocales}
          className="shrink-0 justify-end"
        />
      ) : null}
      </div>
    </div>
  );
}
