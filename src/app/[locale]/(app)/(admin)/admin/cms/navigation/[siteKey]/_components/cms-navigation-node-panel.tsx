"use client";

import { Languages, Loader2, Trash2 } from "lucide-react";

import { LOCALE_LABELS, type Locale } from "@/i18n/config";
import { LocaleFlag } from "@/components/locale-flag";
import { type CmsNavigationFlatNode } from "@/lib/cms/cms-navigation-repository";
import type { CmsCollectionListItem } from "@/lib/cms/entry";
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
import { CMS_NAVIGATION_NODE_TYPES } from "@/types/cms-navigation";

interface CmsNavigationNodePanelProps {
  selectedNode: CmsNavigationFlatNode | null;
  entries: CmsCollectionListItem[];
  availableEntries: CmsCollectionListItem[];
  collectionLabelSingular: string;
  translatableLocales: Locale[];
  isTranslatingTitle: boolean;
  panelResolvedAbsoluteUrl: string | null;
  onUpdateNode: (
    nodeId: string,
    updater: (node: CmsNavigationFlatNode) => CmsNavigationFlatNode
  ) => void;
  onTranslateTitle: (args: { nodeId: string; title: string }) => void;
  onRemoveSelectedNode: () => void;
}

export function CmsNavigationNodePanel({
  selectedNode,
  entries,
  availableEntries,
  collectionLabelSingular,
  translatableLocales,
  isTranslatingTitle,
  panelResolvedAbsoluteUrl,
  onUpdateNode,
  onTranslateTitle,
  onRemoveSelectedNode,
}: CmsNavigationNodePanelProps) {
  return (
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
                  onUpdateNode(selectedNode.id, (node) => ({
                    ...node,
                    title: event.target.value,
                  }))
                }
              />
            </div>

            {translatableLocales.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-sm font-medium">Title translations</label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isTranslatingTitle || !selectedNode.title.trim()}
                    onClick={() => {
                      onTranslateTitle({
                        nodeId: selectedNode.id,
                        title: selectedNode.title,
                      });
                    }}
                  >
                    {isTranslatingTitle ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Languages className="h-3.5 w-3.5" />
                    )}
                    Translate
                  </Button>
                </div>
                {translatableLocales.map((locale) => (
                  <div key={locale} className="flex items-center gap-2">
                    <span
                      className="flex w-6 shrink-0 justify-center"
                      title={LOCALE_LABELS[locale]}
                    >
                      <LocaleFlag locale={locale} />
                    </span>
                    <Input
                      value={selectedNode.titleTranslations?.[locale] ?? ""}
                      placeholder={selectedNode.title}
                      onChange={(event) => {
                        const value = event.target.value;
                        onUpdateNode(selectedNode.id, (node) => ({
                          ...node,
                          titleTranslations: {
                            ...(node.titleTranslations ?? {}),
                            [locale]: value,
                          },
                        }));
                      }}
                    />
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  {selectedNode.nodeType === CMS_NAVIGATION_NODE_TYPES.PAGE
                    ? "Pages show the linked entry's translated title first; these apply when it has no translation."
                    : "Overrides this group's label per language. Blank falls back to the title above."}
                </p>
              </div>
            )}

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

                    onUpdateNode(selectedNode.id, (node) => ({
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
                  onUpdateNode(selectedNode.id, (node) => ({
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
                    rel="noreferrer"
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
              onClick={onRemoveSelectedNode}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Node
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
