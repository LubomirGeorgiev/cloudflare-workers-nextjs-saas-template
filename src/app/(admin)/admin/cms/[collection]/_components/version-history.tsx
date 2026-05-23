"use client";

import React, { useEffect, useMemo, useState } from "react";
import { parseDiffFromFile } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import type { JSONContent } from "@tiptap/core";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatDistanceToNow } from "date-fns";
import { Clock, History, RotateCcw, Trash2 } from "lucide-react";
import type { CmsEntryVersion } from "@/db/schema";
import { useAction } from "next-safe-action/hooks";
import { revertCmsEntryVersionAction, getCmsEntryVersionsAction, deleteCmsEntryVersionAction } from "../../_actions/version-actions";
import { toast } from "sonner";
import type { GetCmsCollectionResult } from "@/lib/cms/cms-repository";
import { ALERT_BLOCK_NODE_NAME } from "@/components/tiptap-node/alert-block/alert-block-types";

const DIFF_RENDER_OPTIONS = {
  disableFileHeader: true,
  disableLineNumbers: true,
  diffStyle: "unified",
  expandUnchanged: true,
  lineDiffType: "word",
  overflow: "wrap",
  theme: {
    dark: "pierre-dark",
    light: "pierre-light",
  },
  themeType: "system",
} as const;

function createContentDiff({
  currentContent,
  selectedContent,
}: {
  currentContent: JSONContent;
  selectedContent: JSONContent;
}) {
  return parseDiffFromFile(
    {
      name: "current.md",
      contents: contentToMarkdown(currentContent),
      lang: "markdown",
    },
    {
      name: "version.md",
      contents: contentToMarkdown(selectedContent),
      lang: "markdown",
    }
  );
}

function createTextDiff({
  currentValue,
  selectedValue,
}: {
  currentValue: string;
  selectedValue: string;
}) {
  return parseDiffFromFile(
    {
      name: "current.txt",
      contents: `${currentValue}\n`,
      lang: "text",
    },
    {
      name: "version.txt",
      contents: `${selectedValue}\n`,
      lang: "text",
    }
  );
}

function contentToMarkdown(content: JSONContent): string {
  return normalizeMarkdown(renderMarkdownNode({ node: content })) || "(empty)";
}

function renderMarkdownNode({
  node,
  parentType,
}: {
  node: JSONContent;
  parentType?: string;
}): string {
  if (typeof node.text === "string") {
    return renderMarkedText({ marks: node.marks, text: node.text });
  }

  switch (node.type) {
    case "doc":
      return renderBlockChildren({ node });
    case "paragraph":
      return renderInlineChildren({ node });
    case "heading":
      return `${"#".repeat(getHeadingLevel(node))} ${renderInlineChildren({ node })}`;
    case "blockquote":
      return prefixLines({ prefix: "> ", value: renderBlockChildren({ node }) });
    case "codeBlock":
      return renderCodeBlock({ node });
    case "bulletList":
    case "orderedList":
    case "taskList":
      return renderList({ node });
    case "listItem":
    case "taskItem":
      return renderListItem({ node });
    case "horizontalRule":
      return "---";
    case "hardBreak":
      return "  \n";
    case "image":
      return renderImage(node);
    case "table":
      return renderTable(node);
    case ALERT_BLOCK_NODE_NAME:
      return renderAlertBlock(node);
    default:
      return parentType === "paragraph"
        ? renderInlineChildren({ node })
        : renderBlockChildren({ node });
  }
}

function renderBlockChildren({
  node,
}: {
  node: JSONContent;
}): string {
  return (node.content ?? [])
    .map((child) => renderMarkdownNode({ node: child, parentType: node.type }))
    .filter((value) => value.trim().length > 0)
    .join("\n\n");
}

function renderInlineChildren({ node }: { node: JSONContent }): string {
  return (node.content ?? [])
    .map((child) => renderMarkdownNode({ node: child, parentType: node.type }))
    .join("");
}

function renderMarkedText({
  marks,
  text,
}: {
  marks: JSONContent["marks"];
  text: string;
}): string {
  return (marks ?? []).reduce((value, mark) => {
    switch (mark.type) {
      case "bold":
        return `**${value}**`;
      case "italic":
        return `*${value}*`;
      case "strike":
        return `~~${value}~~`;
      case "code":
        return `\`${value.replace(/`/g, "\\`")}\``;
      case "link":
        return typeof mark.attrs?.href === "string" ? `[${value}](${mark.attrs.href})` : value;
      case "highlight":
        return `==${value}==`;
      default:
        return value;
    }
  }, text);
}

function renderCodeBlock({ node }: { node: JSONContent }): string {
  const language = typeof node.attrs?.language === "string" ? node.attrs.language : "";

  return `\`\`\`${language}\n${renderInlineChildren({ node })}\n\`\`\``;
}

function renderList({ node }: { node: JSONContent }): string {
  const start = typeof node.attrs?.start === "number" ? node.attrs.start : 1;

  return (node.content ?? [])
    .map((item, index) => {
      const marker = getListMarker({ item, list: node, number: start + index });
      const lines = renderListItem({ node: item }).split("\n");

      return lines
        .map((line, lineIndex) => (lineIndex === 0 ? `${marker} ${line}` : `  ${line}`))
        .join("\n");
    })
    .join("\n");
}

function getListMarker({
  item,
  list,
  number,
}: {
  item: JSONContent;
  list: JSONContent;
  number: number;
}): string {
  if (list.type === "orderedList") {
    return `${number}.`;
  }

  if (list.type === "taskList" || item.type === "taskItem") {
    return item.attrs?.checked ? "- [x]" : "- [ ]";
  }

  return "-";
}

function renderListItem({ node }: { node: JSONContent }): string {
  return (node.content ?? [])
    .map((child) => renderMarkdownNode({ node: child, parentType: node.type }))
    .filter((value) => value.trim().length > 0)
    .join("\n");
}

function renderImage(node: JSONContent): string {
  const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
  const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
  const title = typeof node.attrs?.title === "string" ? ` "${node.attrs.title}"` : "";

  return `![${alt}](${src}${title})`;
}

function renderTable(node: JSONContent): string {
  const rows = (node.content ?? [])
    .map((row) => (row.content ?? [])
      .map((cell) => escapeMarkdownTableCell(renderInlineChildren({ node: cell }).trim()))
    )
    .filter((row) => row.length > 0);

  if (rows.length === 0) {
    return "";
  }

  const [header = [], ...body] = rows;
  const separator = header.map(() => "---");

  return [header, separator, ...body]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
}

function renderAlertBlock(node: JSONContent): string {
  const title = typeof node.attrs?.title === "string" ? node.attrs.title.trim() : "";
  const body = typeof node.attrs?.body === "string" ? node.attrs.body.trim() : "";
  const variant = typeof node.attrs?.variant === "string" ? node.attrs.variant.toUpperCase() : "INFO";
  const lines = [`[!${variant}]`];

  if (title) {
    lines.push(`**${title}**`);
  }

  if (body) {
    lines.push("", ...body.split("\n"));
  }

  return prefixLines({ prefix: "> ", value: lines.join("\n") });
}

function getHeadingLevel(node: JSONContent): number {
  return typeof node.attrs?.level === "number"
    ? Math.min(Math.max(node.attrs.level, 1), 6)
    : 2;
}

function prefixLines({
  prefix,
  value,
}: {
  prefix: string;
  value: string;
}): string {
  return value
    .split("\n")
    .map((line) => `${prefix}${line}`.trimEnd())
    .join("\n");
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function normalizeMarkdown(value: string): string {
  return value
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function FieldDiff({
  currentValue,
  label,
  selectedValue,
}: {
  currentValue: string | null | undefined;
  label: string;
  selectedValue: string | null | undefined;
}) {
  return (
    <div className="p-3 border rounded bg-muted/5">
      <span className="text-muted-foreground block text-xs mb-1">{label}</span>
      <ValueDiff currentValue={currentValue} selectedValue={selectedValue} />
    </div>
  );
}

function ValueDiff({
  currentValue,
  selectedValue,
}: {
  currentValue: string | null | undefined;
  selectedValue: string | null | undefined;
}) {
  const current = currentValue || "None";
  const selected = selectedValue || "None";
  const diff = createTextDiff({
    currentValue: current,
    selectedValue: selected,
  });

  return diff.hunks.length > 0 ? (
    <FileDiff
      className="cms-version-field-diff"
      disableWorkerPool
      fileDiff={diff}
      options={DIFF_RENDER_OPTIONS}
    />
  ) : (
    <span>{current}</span>
  );
}

type VersionHistoryProps = {
  entryId: string;
  currentVersion: GetCmsCollectionResult | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onVersionCountChange?: (count: number) => void;
};

export function VersionHistory({
  entryId,
  currentVersion,
  isOpen,
  onOpenChange,
  onVersionCountChange,
}: VersionHistoryProps) {
  const [selectedVersion, setSelectedVersion] = React.useState<CmsEntryVersion | null>(null);
  const [deleteVersionId, setDeleteVersionId] = useState<string | null>(null);
  const [revertVersionToRestore, setRevertVersionToRestore] = useState<CmsEntryVersion | null>(null);

  const { execute: fetchVersions, result: versionsResult, isExecuting: isLoadingVersions } = useAction(getCmsEntryVersionsAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Failed to load versions");
    },
  });

  useEffect(() => {
    if (isOpen && entryId) {
      fetchVersions({ entryId });
    }
  }, [isOpen, entryId, fetchVersions]);

  const { execute: revertVersion, isExecuting: isReverting } = useAction(revertCmsEntryVersionAction, {
    onSuccess: () => {
      toast.success("Entry reverted successfully");
      onOpenChange(false);
      setSelectedVersion(null);
      window.onbeforeunload = null;
      window.location.reload();
    },
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Failed to revert entry");
    }
  });

  const { execute: deleteVersion, isExecuting: isDeleting } = useAction(deleteCmsEntryVersionAction, {
    onSuccess: () => {
      toast.success("Version deleted successfully");
      if (selectedVersion) {
        setSelectedVersion(null);
      }
      fetchVersions({ entryId });
    },
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Failed to delete version");
    }
  });

  const versions = versionsResult.data;
  useEffect(() => {
    if (versions) {
      onVersionCountChange?.(versions.length);
    }
  }, [onVersionCountChange, versions]);

  const contentDiff = useMemo(() => {
    if (!selectedVersion || !currentVersion) {
      return null;
    }

    return createContentDiff({
      currentContent: currentVersion.content as JSONContent,
      selectedContent: selectedVersion.content as JSONContent,
    });
  }, [currentVersion, selectedVersion]);
  const hasContentChanges = Boolean(contentDiff?.hunks.length);

  const handleRevert = () => {
    if (!selectedVersion) return;
    setRevertVersionToRestore(selectedVersion);
  };

  const confirmRevert = () => {
    if (!revertVersionToRestore) return;

    revertVersion({
      entryId,
      versionId: revertVersionToRestore.id,
    });
    setRevertVersionToRestore(null);
  };

  const handleDelete = (versionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteVersionId(versionId);
  };

  const confirmDelete = () => {
    if (!deleteVersionId) return;

    deleteVersion({
      entryId,
      versionId: deleteVersionId,
    });
    setDeleteVersionId(null);
  };

  return (
    <>
      <style>{`
        .cms-version-content-diff {
          display: block;
          overflow: hidden;
          border: 1px solid hsl(var(--border));
          border-radius: 0.375rem;
          background: hsl(var(--background));
        }

        .cms-version-field-diff {
          display: block;
          max-width: 100%;
          overflow: hidden;
          border: 1px solid hsl(var(--border));
          border-radius: 0.375rem;
          background: hsl(var(--background));
          vertical-align: top;
        }

        .cms-version-field-diff {
          --diffs-gap-block: 0px;
          --diffs-line-height: 1.45;
        }

        .cms-version-content-diff pre,
        .cms-version-field-diff pre {
          margin: 0;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace !important;
          font-size: 0.8125rem !important;
          line-height: 1.6 !important;
        }
      `}</style>

      <Sheet open={isOpen} onOpenChange={onOpenChange}>
        <SheetContent className="w-[1600px] sm:w-[1600px] sm:max-w-[93vw] overflow-hidden flex flex-col p-0 gap-0">
        <SheetHeader className="p-6 border-b">
          <SheetTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Version History
          </SheetTitle>
          <SheetDescription>
            View and restore previous versions of this entry.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 overflow-hidden">
          <div className="w-1/5 border-r overflow-y-auto bg-muted/10">
            <div className="p-4 space-y-3">
               {isLoadingVersions && (
                 <div className="text-center text-muted-foreground py-8">
                   <Clock className="h-6 w-6 animate-spin mx-auto mb-2" />
                   Loading versions...
                 </div>
               )}

               {!isLoadingVersions && (!versions || versions.length === 0) && (
                 <div className="text-center text-muted-foreground py-8">
                   No version history available.
                 </div>
               )}

               {!isLoadingVersions && versions && versions.map((version: CmsEntryVersion, index: number) => {
                 const isLatestVersion = index === 0;
                 const isOnlyVersion = versions.length === 1;
                 const canDelete = !isLatestVersion && !isOnlyVersion;

                 return (
                   <div
                     key={version.id}
                     className={`relative group rounded-lg border transition-all ${
                       selectedVersion?.id === version.id ? "bg-muted border-primary/50 ring-1 ring-primary/20" : "bg-card border-border"
                     }`}
                   >
                     <button
                       onClick={() => setSelectedVersion(version)}
                       className={`w-full text-left p-3 hover:bg-muted/50 rounded-lg transition-all ${canDelete ? 'pr-10' : ''}`}
                     >
                       <div className="flex items-center gap-2 mb-1">
                         <span className="font-medium text-sm">Version {version.versionNumber}</span>
                         {isLatestVersion && (
                           <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
                             Latest
                           </span>
                         )}
                       </div>
                       <div className="flex items-center text-xs text-muted-foreground gap-1">
                         <Clock className="h-3 w-3" />
                         {formatDistanceToNow(new Date(version.createdAt), { addSuffix: true })}
                       </div>
                     </button>
                     {canDelete && (
                       <button
                         onClick={(e) => handleDelete(version.id, e)}
                         disabled={isDeleting}
                         className="absolute top-1/2 -translate-y-1/2 right-2 p-1.5 rounded opacity-0 group-hover:opacity-100 transition-all hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-50"
                         title="Delete version"
                       >
                         <Trash2 className="h-3.5 w-3.5" />
                       </button>
                     )}
                   </div>
                 );
               })}
            </div>
          </div>

          <div className="w-4/5 flex flex-col overflow-hidden bg-background">
            {selectedVersion ? (
              <>
                <div className="p-4 border-b bg-muted/10 flex justify-between items-center">
                  <div>
                    <h3 className="font-medium">
                      Comparing Version {selectedVersion.versionNumber} ({formatDistanceToNow(new Date(selectedVersion.createdAt), { addSuffix: true })})
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Changes needed to restore this version from the current entry{currentVersion ? ` (${formatDistanceToNow(new Date(currentVersion.createdAt), { addSuffix: true })})` : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {(() => {
                      const isLatestVersion = versions && versions.length > 0 && versions[0].id === selectedVersion.id;
                      const isOnlyVersion = versions && versions.length === 1;
                      const canDelete = !isLatestVersion && !isOnlyVersion;

                      return canDelete ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => handleDelete(selectedVersion.id, e)}
                            disabled={isDeleting || isReverting}
                            className="text-destructive hover:text-destructive"
                          >
                            {isDeleting ? (
                              <Clock className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                              <Trash2 className="h-4 w-4 mr-2" />
                            )}
                            Delete
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleRevert}
                            disabled={isReverting || isDeleting}
                          >
                            {isReverting ? (
                              <Clock className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                              <RotateCcw className="h-4 w-4 mr-2" />
                            )}
                            Restore This Version
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleRevert}
                          disabled={isReverting || isDeleting || isLatestVersion}
                        >
                          {isReverting ? (
                            <Clock className="h-4 w-4 animate-spin mr-2" />
                          ) : (
                            <RotateCcw className="h-4 w-4 mr-2" />
                          )}
                          {isLatestVersion ? "Current Version" : "Restore This Version"}
                        </Button>
                      );
                    })()}
                  </div>
                </div>

                <ScrollArea className="flex-1 p-6">
                  <div className="space-y-6">
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-2">Title</h4>
                      <div className="text-lg font-semibold">
                        <ValueDiff
                          currentValue={currentVersion?.title}
                          selectedValue={selectedVersion.title}
                        />
                      </div>
                    </div>

                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-2">Content</h4>
                      {hasContentChanges && contentDiff ? (
                        <FileDiff
                          className="cms-version-content-diff"
                          disableWorkerPool
                          fileDiff={contentDiff}
                          options={DIFF_RENDER_OPTIONS}
                        />
                      ) : contentDiff ? (
                        <div className="border rounded-md p-4 text-muted-foreground">
                          No content changes between this version and the current entry.
                        </div>
                      ) : (
                        <div className="border rounded-md p-4 text-muted-foreground italic">
                          Current entry unavailable.
                        </div>
                      )}
                    </div>

                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-2">Metadata</h4>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <FieldDiff
                          currentValue={currentVersion?.slug}
                          label="Slug"
                          selectedValue={selectedVersion.slug}
                        />
                        <FieldDiff
                          currentValue={currentVersion?.status}
                          label="Status"
                          selectedValue={selectedVersion.status}
                        />
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
                <History className="h-12 w-12 mb-4 opacity-20" />
                <h3 className="text-lg font-medium text-foreground">Select a version</h3>
                <p className="max-w-xs mx-auto mt-2">
                  Choose a version from the list on the left to compare it with the current entry.
                </p>
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>

    <AlertDialog open={deleteVersionId !== null} onOpenChange={(open) => !open && setDeleteVersionId(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete this version.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirmDelete}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog open={revertVersionToRestore !== null} onOpenChange={(open) => !open && setRevertVersionToRestore(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Restore this version?</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to revert to this version? Current changes will be saved as a new version before reverting.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isReverting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirmRevert}
            disabled={isReverting}
          >
            {isReverting ? "Restoring..." : "Restore"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
