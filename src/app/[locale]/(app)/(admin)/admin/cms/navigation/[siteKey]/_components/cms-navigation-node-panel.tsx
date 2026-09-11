"use client";

import { useMemo, useState } from "react";
import {
  Ban,
  Check,
  ExternalLink,
  FileText,
  FolderTree,
  Link2,
  Loader2,
  MousePointerClick,
  Pencil,
  Sparkles,
  Trash2,
} from "lucide-react";

import { LOCALE_LABELS, type Locale } from "@/i18n/config";
import { ICON_COLOR_HELP, iconFollowsCurrentColor } from "@/components/cms-icon";
import { CmsNavigationNodeIcon } from "@/components/cms-navigation-node-icon";
import { ConfirmDestructiveDialog } from "@/components/confirm-destructive-dialog";
import { CopyToClipboardButton } from "@/components/copy-to-clipboard-button";
import { LocaleFlag } from "@/components/locale-flag";
import type { CmsCollectionListItem } from "@/lib/cms/entry";
import { withNodeIcon, type CmsNavigationEditorNode } from "./cms-navigation-tree-model";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { CMS_COLOR_MAX_LENGTH } from "@/constants";
import { CMS_NAVIGATION_NODE_TYPES, type CmsIconBody } from "@/types/cms-navigation";
import { CmsNavigationEntryStatusBadge } from "./cms-navigation-row";
import { CmsIconPicker } from "./cms-icon-picker";
// Type-only, so it is erased and the picker chunk still loads on the first open.
import type { CmsIconSelection } from "./cms-icon-picker-dialog";

// What the native colour input shows before the admin has chosen anything. Never saved on its own:
// the field stays null until a change event fires.
const DEFAULT_NAV_ICON_COLOR = "#64748b";

// One click per common accent, so the usual pick never opens the native colour dialog. Hex only,
// because the column stores the literal string the public icon renders with.
const NAV_ICON_COLOR_PRESETS = [
  { label: "Slate", value: "#64748b" },
  { label: "Red", value: "#ef4444" },
  { label: "Orange", value: "#f97316" },
  { label: "Amber", value: "#f59e0b" },
  { label: "Emerald", value: "#10b981" },
  { label: "Sky", value: "#0ea5e9" },
  { label: "Violet", value: "#8b5cf6" },
  { label: "Pink", value: "#ec4899" },
] as const;

// Overrides the segmented-pill defaults from `TabsTrigger`: no fill, no shadow, and the active
// state is a 2px rule that overlaps the list's own bottom border.
const TAB_TRIGGER_CLASS =
  "-mb-px h-10 flex-1 rounded-none border-b-2 border-transparent bg-transparent text-muted-foreground shadow-none hover:text-foreground data-active:border-primary data-active:bg-transparent data-active:text-foreground data-active:shadow-none";

type UpdateNode = (
  nodeId: string,
  updater: (node: CmsNavigationEditorNode) => CmsNavigationEditorNode
) => void;

interface CmsNavigationNodePanelProps {
  selectedNode: CmsNavigationEditorNode | null;
  entries: CmsCollectionListItem[];
  availableEntries: CmsCollectionListItem[];
  collectionLabelSingular: string;
  translatableLocales: Locale[];
  isTranslatingTitle: boolean;
  panelResolvedPath: string | null;
  panelResolvedAbsoluteUrl: string | null;
  /** How many rows disappear with the selected one, because delete takes the whole subtree. */
  selectedDescendantCount: number;
  usedIcons: CmsIconSelection[];
  onUpdateNode: UpdateNode;
  onTranslateTitle: (args: { nodeId: string; title: string }) => void;
  onPickIcon: (args: CmsIconSelection & { nodeId: string }) => void;
  onRemoveSelectedNode: () => void;
}

function CmsNavigationPanelEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full border border-dashed bg-muted/40 text-muted-foreground">
        <MousePointerClick className="size-5" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium">No item selected</p>
        <p className="text-xs text-muted-foreground">
          Pick a row in the tree to edit its title, icon, link, and translations.
        </p>
      </div>
    </div>
  );
}

function CmsNavigationPanelHeader({
  node,
  icon,
  entryStatus,
  descendantCount,
  onOpenIconPicker,
  onRemove,
}: {
  node: CmsNavigationEditorNode;
  icon: CmsIconBody | undefined;
  entryStatus: string | null;
  descendantCount: number;
  onOpenIconPicker: () => void;
  onRemove: () => void;
}) {
  const isPage = node.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE;
  const displayTitle = node.title || "Untitled";

  return (
    <div className="flex items-start gap-3 border-b bg-muted/40 p-4">
      <button
        type="button"
        title="Change icon"
        aria-label="Change icon"
        onClick={onOpenIconPicker}
        className="group relative flex size-12 shrink-0 items-center justify-center rounded-xl border bg-background shadow-sm transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CmsNavigationNodeIcon
          iconBody={icon}
          nodeType={node.nodeType}
          iconColor={node.iconColor}
          className="size-5"
        />
        <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors group-hover:border-primary group-hover:text-primary">
          <Pencil className="size-2.5" />
        </span>
      </button>

      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="truncate text-base font-semibold leading-tight">{displayTitle}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="gap-1 px-2 py-0.5 font-medium">
            {isPage ? <FileText className="size-3" /> : <FolderTree className="size-3" />}
            {isPage ? "Page" : "Group"}
          </Badge>
          <CmsNavigationEntryStatusBadge status={entryStatus} />
        </div>
      </div>

      <ConfirmDestructiveDialog
        trigger={
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          />
        }
        triggerLabel={
          <>
            <Trash2 className="size-4" />
            <span className="sr-only">Delete node</span>
          </>
        }
        title={`Delete "${displayTitle}"?`}
        description={
          descendantCount > 0
            ? `This also removes ${descendantCount} nested ${
                descendantCount === 1 ? "item" : "items"
              }. Nothing changes on the site until you save the tree.`
            : "Nothing changes on the site until you save the tree."
        }
        confirmLabel="Delete"
        pendingLabel="Deleting..."
        onConfirm={onRemove}
      />
    </div>
  );
}

function CmsNavigationPanelUrlBar({
  isPage,
  resolvedPath,
  resolvedAbsoluteUrl,
}: {
  isPage: boolean;
  resolvedPath: string | null;
  resolvedAbsoluteUrl: string | null;
}) {
  return (
    <div className="flex items-center gap-2 border-b px-4 py-2.5">
      <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
      {resolvedPath && resolvedAbsoluteUrl ? (
        <>
          <span className="truncate font-mono text-xs" title={resolvedAbsoluteUrl}>
            {resolvedPath}
          </span>
          <div className="ml-auto flex shrink-0 items-center">
            <CopyToClipboardButton
              value={resolvedAbsoluteUrl}
              label="Copy public URL"
              className="size-8 p-0"
            />
            <a
              href={resolvedAbsoluteUrl}
              target="_blank"
              rel="noreferrer"
              title="Open public URL"
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ExternalLink className="size-3.5" />
              <span className="sr-only">Open public URL</span>
            </a>
          </div>
        </>
      ) : (
        <span className="truncate text-xs text-muted-foreground">
          {isPage
            ? "Save to generate the canonical path."
            : "No URL segment — this group only organizes pages."}
        </span>
      )}
    </div>
  );
}

function CmsNavigationContentTab({
  node,
  entries,
  availableEntries,
  linkedEntry,
  collectionLabelSingular,
  onUpdateNode,
}: {
  node: CmsNavigationEditorNode;
  entries: CmsCollectionListItem[];
  availableEntries: CmsCollectionListItem[];
  linkedEntry: CmsCollectionListItem | null;
  collectionLabelSingular: string;
  onUpdateNode: UpdateNode;
}) {
  const isPage = node.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE;
  const entryPlaceholder = `Select ${collectionLabelSingular.toLowerCase()} entry`;

  return (
    <TabsContent value="content" className="mt-0 space-y-5">
      <div className="space-y-2">
        <Label htmlFor="nav-node-title">Title</Label>
        <Input
          id="nav-node-title"
          value={node.title}
          onChange={(event) =>
            onUpdateNode(node.id, (current) => ({ ...current, title: event.target.value }))
          }
        />
      </div>

      {isPage ? (
        <div className="space-y-2">
          <Label>Linked {collectionLabelSingular.toLowerCase()}</Label>
          <Select
            value={node.entryId ?? ""}
            onValueChange={(entryId) => {
              const entry = entries.find((candidate) => candidate.id === entryId);

              onUpdateNode(node.id, (current) => ({
                ...current,
                entryId,
                title: current.title || entry?.title || current.title,
                slugSegment: current.slugSegment || entry?.slug || null,
              }));
            }}
          >
            <SelectTrigger className="h-10">
              {/* Base UI reads the label off the mounted items, so a closed popup shows the raw
                  entry id. Format from the entry we already resolved. */}
              <SelectValue placeholder={entryPlaceholder}>
                {() => linkedEntry?.title ?? entryPlaceholder}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {availableEntries.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {linkedEntry ? (
            <p className="truncate font-mono text-xs text-muted-foreground">
              /{linkedEntry.slug}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="nav-node-slug">{isPage ? "Slug segment" : "Group URL segment"}</Label>
        <Input
          id="nav-node-slug"
          className="font-mono text-sm"
          value={node.slugSegment ?? ""}
          onChange={(event) =>
            onUpdateNode(node.id, (current) => ({
              ...current,
              slugSegment: event.target.value,
            }))
          }
          placeholder={isPage ? "getting-started" : "guides"}
        />
        <p className="text-xs text-muted-foreground">
          {isPage
            ? "The local URL segment the full path is built from."
            : "Leave blank to organize pages without adding a URL segment."}
        </p>
      </div>
    </TabsContent>
  );
}

function CmsNavigationStyleTab({
  node,
  icon,
  onOpenIconPicker,
  onUpdateNode,
}: {
  node: CmsNavigationEditorNode;
  icon: CmsIconBody | undefined;
  onOpenIconPicker: () => void;
  onUpdateNode: UpdateNode;
}) {
  const iconColor = node.iconColor ?? null;
  // No icon means the node-type fallback, a lucide glyph that paints with `currentColor`.
  const canRecolor = icon ? iconFollowsCurrentColor(icon) : true;
  const setIconColor = (nextColor: string | null) => {
    onUpdateNode(node.id, (current) => ({ ...current, iconColor: nextColor }));
  };

  return (
    <TabsContent value="style" className="mt-0 space-y-5">
      <div className="space-y-2">
        <Label>Icon</Label>
        <div className="flex items-center gap-3 rounded-lg border p-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted/40">
            <CmsNavigationNodeIcon
              iconBody={icon}
              nodeType={node.nodeType}
              iconColor={iconColor}
              className="size-5"
            />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-xs">{node.icon ?? "Default type icon"}</p>
            <p className="truncate text-xs text-muted-foreground">
              {node.icon
                ? "Shown in the public navigation."
                : "Pick one to replace the type icon."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button type="button" variant="outline" size="sm" onClick={onOpenIconPicker}>
              {node.icon ? "Change" : "Choose"}
            </Button>
            {node.icon ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title="Remove icon"
                className="size-9 text-muted-foreground hover:text-destructive"
                onClick={() => onUpdateNode(node.id, (current) => withNodeIcon(current, null))}
              >
                <Trash2 className="size-4" />
                <span className="sr-only">Remove icon</span>
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="nav-icon-color">Icon color</Label>
        <div
          className={cn(
            "flex flex-wrap items-center gap-1.5",
            !canRecolor && "pointer-events-none opacity-50"
          )}
        >
          <button
            type="button"
            disabled={!canRecolor}
            title="Use the node type color (default)"
            onClick={() => setIconColor(null)}
            className={cn(
              "flex size-7 items-center justify-center rounded-full border bg-background text-muted-foreground transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              !iconColor && "ring-2 ring-ring ring-offset-2 ring-offset-background"
            )}
          >
            <Ban className="size-3.5" />
            <span className="sr-only">Use the node type color</span>
          </button>
          {NAV_ICON_COLOR_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              disabled={!canRecolor}
              title={preset.label}
              onClick={() => setIconColor(preset.value)}
              style={{ backgroundColor: preset.value }}
              className={cn(
                "size-7 rounded-full border border-black/10 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                iconColor?.toLowerCase() === preset.value &&
                  "ring-2 ring-ring ring-offset-2 ring-offset-background"
              )}
            >
              <span className="sr-only">{preset.label}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            id="nav-icon-color"
            type="color"
            aria-label="Custom icon color"
            disabled={!canRecolor}
            value={iconColor ?? DEFAULT_NAV_ICON_COLOR}
            onChange={(event) => setIconColor(event.target.value)}
            className="h-9 w-12 shrink-0 cursor-pointer p-1"
          />
          <Input
            value={iconColor ?? ""}
            maxLength={CMS_COLOR_MAX_LENGTH}
            disabled={!canRecolor}
            placeholder={`${DEFAULT_NAV_ICON_COLOR} (node type color)`}
            onChange={(event) => setIconColor(event.target.value || null)}
            className="h-9 flex-1 font-mono text-xs"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {canRecolor ? ICON_COLOR_HELP.recolorable : ICON_COLOR_HELP.selfPainted}
        </p>
      </div>
    </TabsContent>
  );
}

function CmsNavigationLocalesTab({
  node,
  translatableLocales,
  isTranslatingTitle,
  onTranslateTitle,
  onUpdateNode,
}: {
  node: CmsNavigationEditorNode;
  translatableLocales: Locale[];
  isTranslatingTitle: boolean;
  onTranslateTitle: (args: { nodeId: string; title: string }) => void;
  onUpdateNode: UpdateNode;
}) {
  const isPage = node.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE;

  return (
    <TabsContent value="locales" className="mt-0 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {isPage
            ? "Pages show the linked entry's translated title first; these apply when it has none."
            : "Overrides this group's label per language. Blank falls back to the title."}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={isTranslatingTitle || !node.title.trim()}
          onClick={() => onTranslateTitle({ nodeId: node.id, title: node.title })}
        >
          {isTranslatingTitle ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          Translate
        </Button>
      </div>

      <div className="space-y-3">
        {translatableLocales.map((locale) => {
          const value = node.titleTranslations?.[locale] ?? "";

          return (
            <div key={locale} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="flex w-5 shrink-0 justify-center overflow-hidden rounded-[3px]">
                  <LocaleFlag locale={locale} />
                </span>
                <Label htmlFor={`nav-title-${locale}`} className="text-xs text-muted-foreground">
                  {LOCALE_LABELS[locale]}
                </Label>
                {value.trim() ? (
                  <Check className="ml-auto size-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <span className="ml-auto text-[11px] text-amber-600 dark:text-amber-400">
                    falls back
                  </span>
                )}
              </div>
              <Input
                id={`nav-title-${locale}`}
                className="h-9"
                value={value}
                placeholder={node.title}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  onUpdateNode(node.id, (current) => ({
                    ...current,
                    titleTranslations: {
                      ...(current.titleTranslations ?? {}),
                      [locale]: nextValue,
                    },
                  }));
                }}
              />
            </div>
          );
        })}
      </div>
    </TabsContent>
  );
}

export function CmsNavigationNodePanel({
  selectedNode,
  entries,
  availableEntries,
  collectionLabelSingular,
  translatableLocales,
  isTranslatingTitle,
  panelResolvedPath,
  panelResolvedAbsoluteUrl,
  selectedDescendantCount,
  usedIcons,
  onUpdateNode,
  onTranslateTitle,
  onPickIcon,
  onRemoveSelectedNode,
}: CmsNavigationNodePanelProps) {
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
  const selectedIcon = selectedNode?.iconBody ?? undefined;
  const hasLocales = translatableLocales.length > 0;

  const linkedEntry = useMemo(
    () => entries.find((entry) => entry.id === selectedNode?.entryId) ?? null,
    [entries, selectedNode?.entryId]
  );

  const translatedLocaleCount = useMemo(
    () =>
      translatableLocales.filter((locale) =>
        (selectedNode?.titleTranslations?.[locale] ?? "").trim()
      ).length,
    [selectedNode?.titleTranslations, translatableLocales]
  );

  // `self-start` keeps the panel its own height; the grid would otherwise stretch it to the tree.
  return (
    <Card className="flex flex-col self-start overflow-hidden">
      {!selectedNode ? (
        <CmsNavigationPanelEmptyState />
      ) : (
        <>
          <CmsNavigationPanelHeader
            node={selectedNode}
            icon={selectedIcon}
            entryStatus={linkedEntry?.status ?? null}
            descendantCount={selectedDescendantCount}
            onOpenIconPicker={() => setIsIconPickerOpen(true)}
            onRemove={onRemoveSelectedNode}
          />

          <CmsNavigationPanelUrlBar
            isPage={selectedNode.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE}
            resolvedPath={panelResolvedPath}
            resolvedAbsoluteUrl={panelResolvedAbsoluteUrl}
          />

          <Tabs defaultValue="content" className="flex flex-col">
            {/* Underline, not the segmented pill: in dark mode the pill's active tab is darker
                than the card it sits on, which reads as a hole rather than a selection. */}
            <TabsList className="flex h-auto w-full items-stretch justify-start rounded-none border-b bg-transparent p-0">
              <TabsTrigger value="content" className={TAB_TRIGGER_CLASS}>
                Content
              </TabsTrigger>
              <TabsTrigger value="style" className={TAB_TRIGGER_CLASS}>
                Style
              </TabsTrigger>
              {hasLocales ? (
                <TabsTrigger value="locales" className={cn(TAB_TRIGGER_CLASS, "gap-1.5")}>
                  Locales
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[11px] font-semibold leading-4",
                      translatedLocaleCount === translatableLocales.length
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                        : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                    )}
                  >
                    {translatedLocaleCount}/{translatableLocales.length}
                  </span>
                </TabsTrigger>
              ) : null}
            </TabsList>

            <div className="p-4">
              <CmsNavigationContentTab
                node={selectedNode}
                entries={entries}
                availableEntries={availableEntries}
                linkedEntry={linkedEntry}
                collectionLabelSingular={collectionLabelSingular}
                onUpdateNode={onUpdateNode}
              />

              <CmsNavigationStyleTab
                node={selectedNode}
                icon={selectedIcon}
                onOpenIconPicker={() => setIsIconPickerOpen(true)}
                onUpdateNode={onUpdateNode}
              />

              {hasLocales ? (
                <CmsNavigationLocalesTab
                  node={selectedNode}
                  translatableLocales={translatableLocales}
                  isTranslatingTitle={isTranslatingTitle}
                  onTranslateTitle={onTranslateTitle}
                  onUpdateNode={onUpdateNode}
                />
              ) : null}
            </div>
          </Tabs>
        </>
      )}

      <CmsIconPicker
        open={isIconPickerOpen}
        onOpenChange={setIsIconPickerOpen}
        usedIcons={usedIcons}
        onSelect={({ key, icon, svg }) => {
          if (selectedNode) {
            onPickIcon({ nodeId: selectedNode.id, key, icon, svg });
          }
        }}
      />
    </Card>
  );
}
