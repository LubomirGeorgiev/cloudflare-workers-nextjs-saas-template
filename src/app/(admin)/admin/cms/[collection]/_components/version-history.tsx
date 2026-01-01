"use client";

import React, { useEffect, useRef, useState } from "react";
import * as Diff from "diff";
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
import { useServerAction } from "zsa-react";
import { revertCmsEntryVersionAction, getCmsEntryVersionsAction, deleteCmsEntryVersionAction } from "../../_actions/version-actions";
import { toast } from "sonner";
import { CmsContentRenderer } from "@/components/cms-content-renderer";

import "@/components/tiptap-templates/simple/cms-content-styles.scss";

/**
 * Generate HTML-aware diff with word-level highlighting
 * This function processes HTML blocks and performs word-level diffs within changed blocks
 */
function generateHtmlDiff(oldHtml: string, newHtml: string): Diff.Change[] {
  // Parse HTML into DOM
  const parser = new DOMParser();
  const oldDoc = parser.parseFromString(oldHtml, 'text/html');
  const newDoc = parser.parseFromString(newHtml, 'text/html');

  // Get the root elements
  const oldRoot = oldDoc.body;
  const newRoot = newDoc.body;

  // Convert DOM to normalized strings for diffing at a granular level
  const oldBlocks = serializeToBlocks(oldRoot);
  const newBlocks = serializeToBlocks(newRoot);

  // Perform diff on serialized blocks
  const blockDiff = Diff.diffArrays(oldBlocks, newBlocks, {
    comparator: (left, right) => left.html === right.html
  });

  // Convert block diff back to Change[] format with word-level diffing for changed blocks
  const changes: Diff.Change[] = [];

  // Track removed and added blocks to find modified pairs
  let pendingRemoved: BlockNode[] = [];

  for (let i = 0; i < blockDiff.length; i++) {
    const part = blockDiff[i];

    if (part.removed) {
      // Store removed blocks temporarily
      pendingRemoved = part.value as BlockNode[];
    } else if (part.added && pendingRemoved.length > 0) {
      // We have both removed and added blocks - check if they're modifications
      const addedBlocks = part.value as BlockNode[];

      // Try to pair up blocks of the same type for word-level diffing
      const { paired, unpaired: unpairedRemoved, unpaired: unpairedAdded } = pairBlocks(pendingRemoved, addedBlocks);

      // Add unpaired removed blocks (completely deleted)
      for (const block of unpairedRemoved) {
        changes.push({
          added: false,
          removed: true,
          value: block.html,
          count: 1
        });
      }

      // Add paired blocks with word-level diff
      for (const { oldBlock, newBlock } of paired) {
        const wordDiff = generateWordLevelDiff(oldBlock, newBlock);
        changes.push(...wordDiff);
      }

      // Add unpaired added blocks (completely new)
      for (const block of unpairedAdded) {
        changes.push({
          added: true,
          removed: false,
          value: block.html,
          count: 1
        });
      }

      pendingRemoved = [];
    } else {
      // Flush any pending removed blocks
      if (pendingRemoved.length > 0) {
        for (const block of pendingRemoved) {
          changes.push({
            added: false,
            removed: true,
            value: block.html,
            count: 1
          });
        }
        pendingRemoved = [];
      }

      if (part.added) {
        for (const block of part.value as BlockNode[]) {
          changes.push({
            added: true,
            removed: false,
            value: block.html,
            count: 1
          });
        }
      } else {
        for (const block of part.value as BlockNode[]) {
          changes.push({
            added: false,
            removed: false,
            value: block.html,
            count: 1
          });
        }
      }
    }
  }

  // Flush any remaining pending removed blocks
  if (pendingRemoved.length > 0) {
    for (const block of pendingRemoved) {
      changes.push({
        added: false,
        removed: true,
        value: block.html,
        count: 1
      });
    }
  }

  return changes;
}

/**
 * Pair up removed and added blocks of the same type for word-level diffing
 */
function pairBlocks(
  removedBlocks: BlockNode[],
  addedBlocks: BlockNode[]
): {
  paired: Array<{ oldBlock: BlockNode; newBlock: BlockNode }>;
  unpaired: BlockNode[];
} {
  const paired: Array<{ oldBlock: BlockNode; newBlock: BlockNode }> = [];
  const unpairedRemoved: BlockNode[] = [];
  const unpairedAdded: BlockNode[] = [];

  const addedCopy = [...addedBlocks];

  for (const removedBlock of removedBlocks) {
    // Find a matching block of the same type
    const matchIndex = addedCopy.findIndex(b => b.type === removedBlock.type);

    if (matchIndex !== -1) {
      const addedBlock = addedCopy[matchIndex];
      addedCopy.splice(matchIndex, 1);
      paired.push({ oldBlock: removedBlock, newBlock: addedBlock });
    } else {
      unpairedRemoved.push(removedBlock);
    }
  }

  unpairedAdded.push(...addedCopy);

  return { paired, unpaired: [...unpairedRemoved, ...unpairedAdded] };
}

/**
 * Generate word-level diff for two blocks of the same type
 */
function generateWordLevelDiff(oldBlock: BlockNode, newBlock: BlockNode): Diff.Change[] {
  // Special handling for tables - do row-level diffing
  if (oldBlock.type === 'table' && newBlock.type === 'table') {
    return generateTableDiff(oldBlock.html, newBlock.html);
  }

  // Complex structures that should not have word-level diffing
  const complexTypes = new Set(['ul', 'ol', 'pre', 'blockquote']);

  // For other complex structures, just show them as block-level diffs
  if (complexTypes.has(oldBlock.type) || complexTypes.has(newBlock.type)) {
    return [
      { added: false, removed: true, value: oldBlock.html, count: 1 },
      { added: true, removed: false, value: newBlock.html, count: 1 }
    ];
  }

  // Extract text content and structure
  const parser = new DOMParser();

  // For text nodes, do word-level diff directly
  if (oldBlock.type === 'text' || newBlock.type === 'text') {
    const wordDiff = Diff.diffWords(oldBlock.html, newBlock.html);
    return wordDiff.map(part => ({
      added: part.added || false,
      removed: part.removed || false,
      value: part.value,
      count: 1
    }));
  }

  // For HTML elements, parse and do word-level diff on inner content
  const oldDoc = parser.parseFromString(oldBlock.html, 'text/html');
  const newDoc = parser.parseFromString(newBlock.html, 'text/html');

  const oldElement = oldDoc.body.firstChild as HTMLElement;
  const newElement = newDoc.body.firstChild as HTMLElement;

  if (!oldElement || !newElement) {
    // Fallback to block-level diff
    return [
      { added: false, removed: true, value: oldBlock.html, count: 1 },
      { added: true, removed: false, value: newBlock.html, count: 1 }
    ];
  }

  // Check if the elements contain complex nested structures
  if (hasComplexStructure(oldElement) || hasComplexStructure(newElement)) {
    // Fallback to block-level diff for complex nested content
    return [
      { added: false, removed: true, value: oldBlock.html, count: 1 },
      { added: true, removed: false, value: newBlock.html, count: 1 }
    ];
  }

  const oldText = oldElement.textContent || '';
  const newText = newElement.textContent || '';

  // Perform word-level diff on text content
  const wordDiff = Diff.diffWords(oldText, newText);

  // Reconstruct HTML with inline word-level highlighting
  const changes: Diff.Change[] = [];

  // Get the opening and closing tags
  const oldTagMatch = oldBlock.html.match(/^<([^>\s]+)([^>]*)>/);
  const closingTagMatch = oldBlock.html.match(/<\/([^>]+)>$/);

  if (!oldTagMatch) {
    // Fallback to block-level diff
    return [
      { added: false, removed: true, value: oldBlock.html, count: 1 },
      { added: true, removed: false, value: newBlock.html, count: 1 }
    ];
  }

  const openingTag = oldTagMatch[0];
  const closingTag = closingTagMatch ? closingTagMatch[0] : '';

  // Add opening tag as unchanged
  changes.push({
    added: false,
    removed: false,
    value: openingTag,
    count: 1
  });

  // Add word-level diffs
  for (const part of wordDiff) {
    if (part.added) {
      changes.push({
        added: true,
        removed: false,
        value: `<span class="diff-word-added">${escapeHtml(part.value)}</span>`,
        count: 1
      });
    } else if (part.removed) {
      changes.push({
        added: false,
        removed: true,
        value: `<span class="diff-word-removed">${escapeHtml(part.value)}</span>`,
        count: 1
      });
    } else {
      changes.push({
        added: false,
        removed: false,
        value: escapeHtml(part.value),
        count: 1
      });
    }
  }

  // Add closing tag as unchanged
  if (closingTag) {
    changes.push({
      added: false,
      removed: false,
      value: closingTag,
      count: 1
    });
  }

  return changes;
}

/**
 * Check if an element has complex nested structure that shouldn't be word-diffed
 * Note: Tables are excluded because they have specialized row-level diffing
 */
function hasComplexStructure(element: HTMLElement): boolean {
  // Table is handled separately with row-level diffing, so exclude it
  const complexTags = ['ul', 'ol', 'pre', 'blockquote'];

  // Check the element itself
  if (complexTags.includes(element.tagName.toLowerCase())) {
    return true;
  }

  // Check if it contains any complex nested elements
  for (const tag of complexTags) {
    if (element.querySelector(tag)) {
      return true;
    }
  }

  return false;
}

/**
 * Generate row-level diff for tables
 */
function generateTableDiff(oldTableHtml: string, newTableHtml: string): Diff.Change[] {
  const parser = new DOMParser();
  const oldDoc = parser.parseFromString(oldTableHtml, 'text/html');
  const newDoc = parser.parseFromString(newTableHtml, 'text/html');

  const oldTable = oldDoc.body.querySelector('table');
  const newTable = newDoc.body.querySelector('table');

  if (!oldTable || !newTable) {
    // Fallback to block-level diff
    return [
      { added: false, removed: true, value: oldTableHtml, count: 1 },
      { added: true, removed: false, value: newTableHtml, count: 1 }
    ];
  }

  // Extract table structure (opening tag, colgroup, etc.)
  const tableOpenMatch = oldTableHtml.match(/^<table[^>]*>/);
  const tableOpen = tableOpenMatch ? tableOpenMatch[0] : '<table>';

  // Extract colgroup if present
  const oldColgroup = oldTable.querySelector('colgroup');
  const colgroupHtml = oldColgroup ? oldColgroup.outerHTML : '';

  // Extract rows from both tables
  const oldRows = extractTableRows(oldTable);
  const newRows = extractTableRows(newTable);

  // Perform diff on rows
  const rowDiff = Diff.diffArrays(oldRows, newRows, {
    comparator: (left, right) => left === right
  });

  // Build the complete table HTML with row-level highlighting
  let tableHtml = tableOpen;

  // Add colgroup if present
  if (colgroupHtml) {
    tableHtml += colgroupHtml;
  }

  // Add tbody opening
  tableHtml += '<tbody>';

  // Add rows with diff highlighting
  for (const part of rowDiff) {
    if (part.added) {
      for (const row of part.value as string[]) {
        // Highlight added rows
        tableHtml += `<tr class="diff-table-row-added">${extractRowContent(row)}</tr>`;
      }
    } else if (part.removed) {
      for (const row of part.value as string[]) {
        // Highlight removed rows
        tableHtml += `<tr class="diff-table-row-removed">${extractRowContent(row)}</tr>`;
      }
    } else {
      for (const row of part.value as string[]) {
        // Unchanged rows
        tableHtml += row;
      }
    }
  }

  // Add tbody closing
  tableHtml += '</tbody>';

  // Add table closing tag
  tableHtml += '</table>';

  // Return as a single change object
  return [
    {
      added: false,
      removed: false,
      value: tableHtml,
      count: 1
    }
  ];
}

/**
 * Extract all rows from a table element
 */
function extractTableRows(table: HTMLTableElement): string[] {
  const rows: string[] = [];

  // Get all rows from thead, tbody, and direct children
  const allRows = table.querySelectorAll('tr');

  allRows.forEach(row => {
    rows.push(row.outerHTML);
  });

  return rows;
}

/**
 * Extract the inner content of a table row (without the tr tags)
 */
function extractRowContent(rowHtml: string): string {
  const match = rowHtml.match(/<tr[^>]*>([\s\S]*)<\/tr>/);
  return match ? match[1] : rowHtml;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Check if content contains block-level HTML elements
 */
function isBlockLevelContent(html: string): boolean {
  // Block-level elements that should be wrapped in div, not span
  const blockLevelTags = [
    'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'ul', 'ol', 'li', 'blockquote', 'pre',
    'section', 'article', 'header', 'footer', 'nav', 'aside',
    'hr', 'form', 'fieldset', 'dl', 'dd', 'dt'
  ];

  // Check if the HTML starts with a block-level tag
  const trimmed = html.trim();
  for (const tag of blockLevelTags) {
    if (trimmed.startsWith(`<${tag}`) || trimmed.startsWith(`<${tag.toUpperCase()}`)) {
      return true;
    }
  }

  return false;
}

type BlockNode = {
  html: string;
  type: string;
};

/**
 * Serialize DOM to granular block-level elements
 * Processes each structural element individually for fine-grained diffs
 */
function serializeToBlocks(root: HTMLElement): BlockNode[] {
  const blocks: BlockNode[] = [];

  // Atomic block elements - treat as complete units (don't traverse into them)
  const atomicBlockElements = new Set([
    'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'PRE', 'BLOCKQUOTE', 'HR',
    'TABLE',  // Tables must be kept intact with their structure
    'UL', 'OL'  // Lists should be kept together with their items
  ]);

  // Container elements that we should traverse into (not treat as atomic blocks)
  const containerElements = new Set([
    'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'NAV', 'ASIDE'
  ]);

  function traverse(node: Node): void {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      const tagName = element.tagName;

      // If it's an atomic block element, add it as a complete unit
      if (atomicBlockElements.has(tagName)) {
        blocks.push({
          html: element.outerHTML,
          type: tagName.toLowerCase()
        });
        return;
      }

      // If it's a container, traverse its children
      if (containerElements.has(tagName)) {
        for (const child of Array.from(element.childNodes)) {
          traverse(child);
        }
        return;
      }

      // For other elements, add as atomic units
      blocks.push({
        html: element.outerHTML,
        type: tagName.toLowerCase()
      });
    } else if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      // Only add non-whitespace text nodes
      if (text.trim()) {
        blocks.push({
          html: text,
          type: 'text'
        });
      }
    }
  }

  // Process all children
  for (const child of Array.from(root.childNodes)) {
    traverse(child);
  }

  return blocks;
}

type VersionHistoryProps = {
  entryId: string;
  // TODO currentVersion should be of type GetCmsCollectionResult
  currentVersion: CmsEntryVersion | null; // Using CmsEntryVersion type for current state too for simplicity
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

export function VersionHistory({
  entryId,
  currentVersion,
  isOpen,
  onOpenChange
}: VersionHistoryProps) {
  const [selectedVersion, setSelectedVersion] = React.useState<CmsEntryVersion | null>(null);
  const [htmlDiff, setHtmlDiff] = useState<Diff.Change[] | null>(null);
  const currentVersionRef = useRef<HTMLDivElement>(null);
  const selectedVersionRef = useRef<HTMLDivElement>(null);
  const [currentRendered, setCurrentRendered] = useState(false);
  const [selectedRendered, setSelectedRendered] = useState(false);
  const [deleteVersionId, setDeleteVersionId] = useState<string | null>(null);
  const [revertVersionToRestore, setRevertVersionToRestore] = useState<CmsEntryVersion | null>(null);

  // Fetch versions lazily when the sheet is opened
  const { execute: fetchVersions, data: versions, isPending: isLoadingVersions } = useServerAction(getCmsEntryVersionsAction);

  // Fetch versions when sheet opens
  useEffect(() => {
    if (isOpen && entryId) {
      fetchVersions({ entryId });
    }
  }, [isOpen, entryId, fetchVersions]);

  const { execute: revertVersion, isPending: isReverting } = useServerAction(revertCmsEntryVersionAction, {
    onSuccess: () => {
      toast.success("Entry reverted successfully");
      onOpenChange(false);
      setSelectedVersion(null);
      // Disable unsaved confirmation modal before reloading
      window.onbeforeunload = null;
      window.location.reload();
    },
    onError: (error) => {
      toast.error(error.err?.message || "Failed to revert entry");
    }
  });

  const { execute: deleteVersion, isPending: isDeleting } = useServerAction(deleteCmsEntryVersionAction, {
    onSuccess: () => {
      toast.success("Version deleted successfully");
      // Clear selected version if it was deleted
      if (selectedVersion) {
        setSelectedVersion(null);
      }
      // Refetch versions
      fetchVersions({ entryId });
    },
    onError: (error) => {
      toast.error(error.err?.message || "Failed to delete version");
    }
  });

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
    e.stopPropagation(); // Prevent selecting the version when clicking delete
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

  // Reset rendered state when versions change
  useEffect(() => {
    setCurrentRendered(false);
    setSelectedRendered(false);
    setHtmlDiff(null);
  }, [selectedVersion, currentVersion]);

  // Extract HTML from rendered CmsContentRenderer components and generate diff
  useEffect(() => {
    if (!selectedVersion || !currentVersion || !currentRendered || !selectedRendered) {
      return;
    }

    if (!currentVersionRef.current || !selectedVersionRef.current) {
      return;
    }

    try {
      const currentHtml = currentVersionRef.current.innerHTML || '';
      const selectedHtml = selectedVersionRef.current.innerHTML || '';

      // Generate HTML-aware diff that respects element boundaries
      const diff = generateHtmlDiff(currentHtml, selectedHtml);
      setHtmlDiff(diff);
    } catch (e) {
      console.error("Error generating HTML diff", e);
      setHtmlDiff(null);
    }
  }, [selectedVersion, currentVersion, currentRendered, selectedRendered]);


  return (
    <>
      <style>{`
        /* Block-level diffs (entire blocks added/removed) */
        .cms-content-diff > .diff-added,
        .cms-content-diff > .diff-added > * {
          background-color: rgb(220 252 231) !important;
          color: rgb(22 101 52) !important;
        }

        .cms-content-diff > .diff-removed,
        .cms-content-diff > .diff-removed > * {
          background-color: rgb(254 226 226) !important;
          color: rgb(153 27 27) !important;
          text-decoration: line-through !important;
        }

        /* Word-level diffs (inline changes within blocks) */
        .cms-content-diff .diff-word-added {
          background-color: rgb(187 247 208) !important;
          color: rgb(21 128 61) !important;
          padding: 0 2px;
          border-radius: 2px;
          font-weight: 500;
        }

        .cms-content-diff .diff-word-removed {
          background-color: rgb(254 202 202) !important;
          color: rgb(185 28 28) !important;
          text-decoration: line-through !important;
          padding: 0 2px;
          border-radius: 2px;
          font-weight: 500;
        }

        /* Table row-level diffs */
        .cms-content-diff .diff-table-row-added,
        .cms-content-diff .diff-table-row-added > * {
          background-color: rgb(220 252 231) !important;
          color: rgb(22 101 52) !important;
        }

        .cms-content-diff .diff-table-row-removed,
        .cms-content-diff .diff-table-row-removed > * {
          background-color: rgb(254 226 226) !important;
          color: rgb(153 27 27) !important;
          text-decoration: line-through !important;
        }

        /* Ensure tables in diffs maintain proper structure */
        .cms-content-diff > div > table,
        .cms-content-diff > div > table * {
          display: revert !important;
        }

        /* Dark mode styles */
        .dark .cms-content-diff > .diff-added,
        .dark .cms-content-diff > .diff-added > * {
          background-color: rgb(20 83 45 / 0.3) !important;
          color: rgb(134 239 172) !important;
        }

        .dark .cms-content-diff > .diff-removed,
        .dark .cms-content-diff > .diff-removed > * {
          background-color: rgb(127 29 29 / 0.3) !important;
          color: rgb(252 165 165) !important;
          text-decoration: line-through !important;
        }

        .dark .cms-content-diff .diff-word-added {
          background-color: rgb(21 128 61 / 0.4) !important;
          color: rgb(187 247 208) !important;
        }

        .dark .cms-content-diff .diff-word-removed {
          background-color: rgb(153 27 27 / 0.4) !important;
          color: rgb(254 202 202) !important;
        }

        .dark .cms-content-diff .diff-table-row-added,
        .dark .cms-content-diff .diff-table-row-added > * {
          background-color: rgb(20 83 45 / 0.3) !important;
          color: rgb(134 239 172) !important;
        }

        .dark .cms-content-diff .diff-table-row-removed,
        .dark .cms-content-diff .diff-table-row-removed > * {
          background-color: rgb(127 29 29 / 0.3) !important;
          color: rgb(252 165 165) !important;
          text-decoration: line-through !important;
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
          {/* Version List */}
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

               {!isLoadingVersions && versions && versions.map((version, index) => {
                 const isLatestVersion = index === 0; // First in the list is the latest (sorted by versionNumber desc)
                 const isOnlyVersion = versions.length === 1;
                 const canDelete = !isLatestVersion && !isOnlyVersion;

                 return (
                   <div
                     key={version.id}
                     className={`relative group rounded-lg border transition-colors ${
                       selectedVersion?.id === version.id ? "bg-muted border-primary/50 ring-1 ring-primary/20" : "bg-card border-border"
                     }`}
                   >
                     <button
                       onClick={() => setSelectedVersion(version)}
                       className={`w-full text-left p-3 hover:bg-muted/50 rounded-lg transition-colors ${canDelete ? 'pr-10' : ''}`}
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
                         className="absolute top-1/2 -translate-y-1/2 right-2 p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/10 text-muted-foreground hover:text-destructive disabled:opacity-50"
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

          {/* Diff View */}
          <div className="w-4/5 flex flex-col overflow-hidden bg-background">
            {selectedVersion ? (
              <>
                <div className="p-4 border-b bg-muted/10 flex justify-between items-center">
                  <div>
                    <h3 className="font-medium">
                      Comparing Version {selectedVersion.versionNumber} ({formatDistanceToNow(new Date(selectedVersion.createdAt), { addSuffix: true })})
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Against current version{currentVersion ? ` (${formatDistanceToNow(new Date(currentVersion.createdAt), { addSuffix: true })})` : ''}
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
                     {/* Title Diff */}
                     <div>
                       <h4 className="text-sm font-medium text-muted-foreground mb-2">Title</h4>
                       <div className="text-lg font-semibold">
                         {selectedVersion.title !== currentVersion?.title ? (
                           <div>
                              <span className="bg-red-100 text-red-900 line-through px-1 rounded mr-2">{currentVersion?.title}</span>
                              <span className="bg-green-100 text-green-900 px-1 rounded">{selectedVersion.title}</span>
                           </div>
                         ) : (
                           selectedVersion.title
                         )}
                       </div>
                     </div>

                    {/* Content Diff (Visual) */}
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-2">Content</h4>
                      <div className="border rounded-md p-4 bg-white dark:bg-gray-950">
                         {/* Hidden renderers to extract HTML */}
                         <div ref={currentVersionRef} className="hidden">
                           {currentVersion && (
                             <CmsContentRenderer
                               content={currentVersion.content}
                               onRendered={() => setCurrentRendered(true)}
                             />
                           )}
                         </div>
                         <div ref={selectedVersionRef} className="hidden">
                           {selectedVersion && (
                             <CmsContentRenderer
                               content={selectedVersion.content}
                               onRendered={() => setSelectedRendered(true)}
                             />
                           )}
                         </div>

                         {htmlDiff ? (
                           <div className="tiptap ProseMirror cms-content-diff">
                              {htmlDiff.map((part, index) => {
                                const className = part.added ? 'diff-added' : part.removed ? 'diff-removed' : '';
                                // Determine if this is block-level content or inline content
                                const isBlockLevel = isBlockLevelContent(part.value);
                                const WrapperElement = isBlockLevel ? 'div' : 'span';

                                return (
                                  <WrapperElement
                                    key={index}
                                    className={className}
                                    dangerouslySetInnerHTML={{ __html: part.value }}
                                  />
                                );
                              })}
                           </div>
                         ) : (
                           <div className="text-muted-foreground italic">Generating diff...</div>
                         )}
                      </div>
                    </div>

                     {/* Fields Diff - simplified for now */}
                     <div>
                       <h4 className="text-sm font-medium text-muted-foreground mb-2">Metadata</h4>
                       <div className="grid grid-cols-2 gap-4 text-sm">
                          <div className="p-3 border rounded bg-muted/5">
                            <span className="text-muted-foreground block text-xs mb-1">Slug</span>
                            {selectedVersion.slug !== currentVersion?.slug ? (
                               <div>
                                  <span className="bg-red-100 text-red-900 line-through px-1 rounded mr-1">{currentVersion?.slug}</span>
                                  <span className="bg-green-100 text-green-900 px-1 rounded">{selectedVersion.slug}</span>
                               </div>
                             ) : selectedVersion.slug}
                          </div>

                          <div className="p-3 border rounded bg-muted/5">
                            <span className="text-muted-foreground block text-xs mb-1">Status</span>
                            {selectedVersion.status !== currentVersion?.status ? (
                               <div>
                                  <span className="bg-red-100 text-red-900 line-through px-1 rounded mr-1">{currentVersion?.status}</span>
                                  <span className="bg-green-100 text-green-900 px-1 rounded">{selectedVersion.status}</span>
                               </div>
                             ) : selectedVersion.status}
                          </div>
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

    {/* Delete Version Confirmation Dialog */}
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

    {/* Restore Version Confirmation Dialog */}
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
