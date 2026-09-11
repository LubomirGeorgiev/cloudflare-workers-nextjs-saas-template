"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useAction } from "next-safe-action/hooks";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import {
  parseCmsCustomIconAction,
  searchCmsIconsAction,
} from "@/app/[locale]/(app)/(admin)/admin/_actions/cms-navigation-actions";
import { CmsIcon } from "@/components/cms-icon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CMS_ICON_SEARCH_QUERY_MAX_LENGTH, CMS_ICON_UPLOAD_MAX_LENGTH } from "@/constants";
import { CMS_ICON_SET_LABELS } from "@/constants/cms-icons";
import type { CmsIconBody } from "@/types/cms-navigation";

// Long enough that a typed word is one search, short enough to feel immediate.
const CMS_ICON_SEARCH_DEBOUNCE_MS = 300;

// What the file dialog offers. Firefox matches on the extension, the others on the media type.
const SVG_UPLOAD_ACCEPT = ".svg,image/svg+xml";

/** The file name without its extension, which is what the icon key's readable half comes from. */
function getIconLabelFromFileName(fileName: string): string {
  return fileName.replace(/\.svg$/i, "").trim() || "icon";
}

/** One pick. `svg` is present only for an upload, whose markup is not stored on the tree yet. */
export interface CmsIconSelection {
  key: string;
  icon: CmsIconBody;
  svg?: string;
}

export interface CmsIconPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Icons already pinned on this tree — picking one of these costs no request. */
  usedIcons: CmsIconSelection[];
  onSelect: (selection: CmsIconSelection) => void;
}

function CmsIconButton({
  selection,
  onSelect,
}: {
  selection: CmsIconSelection;
  onSelect: (selection: CmsIconSelection) => void;
}) {
  return (
    <button
      type="button"
      title={selection.key}
      onClick={() => onSelect(selection)}
      className="flex aspect-square items-center justify-center rounded-md border text-foreground transition-colors hover:border-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <CmsIcon icon={selection.icon} className="h-5 w-5" />
    </button>
  );
}

// fallow-ignore-next-line unused-export -- Reached by dynamic import from cms-icon-picker.tsx.
export function CmsIconPickerDialog({
  open,
  onOpenChange,
  usedIcons,
  onSelect,
}: CmsIconPickerProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  const { execute: searchIcons, result, isExecuting } = useAction(searchCmsIconsAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Failed to search icons");
    },
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, CMS_ICON_SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open || debouncedQuery.length === 0) {
      return;
    }

    searchIcons({ query: debouncedQuery });
  }, [debouncedQuery, open, searchIcons]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const groups = result.data?.groups ?? [];

  const handleSelect = (selection: CmsIconSelection) => {
    onSelect(selection);
    onOpenChange(false);
  };

  const { execute: parseUpload, isExecuting: isUploading } = useAction(parseCmsCustomIconAction, {
    onSuccess: ({ data }) => {
      if (data) {
        // The document comes back with the selection: the row has to carry it to the save, which
        // parses it again rather than trusting the body we just previewed.
        handleSelect({ key: data.key, icon: data.icon, svg: data.svg });
      }
    },
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "That SVG could not be used as an icon");
    },
  });

  const handleFileChosen = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Cleared straight away, so choosing the same file twice still fires a change event.
    event.target.value = "";

    if (!file) {
      return;
    }

    if (file.size > CMS_ICON_UPLOAD_MAX_LENGTH) {
      toast.error(`That SVG is larger than ${CMS_ICON_UPLOAD_MAX_LENGTH / 1024} KB.`);
      return;
    }

    parseUpload({ label: getIconLabelFromFileName(file.name), svg: await file.text() });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose Icon</DialogTitle>
          <DialogDescription>
            One search covers every icon set, or upload your own SVG. The chosen icon is pinned to
            the row when you save, so the public site renders it without calling the icon service.
            An upload is stored as you drew it — gradients, filters and clip paths included, and its
            own colours kept. It is refused only if it embeds an image, carries script or a
            stylesheet, or points at anything outside itself.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              value={query}
              autoFocus
              maxLength={CMS_ICON_SEARCH_QUERY_MAX_LENGTH}
              placeholder="Search all icon sets, for example house, book, or rocket..."
              onChange={(event) => setQuery(event.target.value)}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept={SVG_UPLOAD_ACCEPT}
              className="hidden"
              onChange={handleFileChosen}
            />
            <Button
              type="button"
              variant="outline"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {isUploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              Upload SVG
            </Button>
          </div>

          {usedIcons.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Used in this navigation</p>
              <div className="grid grid-cols-8 gap-2 sm:grid-cols-12">
                {usedIcons.map((usedIcon) => (
                  <CmsIconButton
                    key={usedIcon.key}
                    selection={usedIcon}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div className="min-h-[220px] max-h-[320px] overflow-y-auto rounded-md border p-3">
            {debouncedQuery.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">
                Type a word to search every icon set.
              </p>
            ) : isExecuting ? (
              <div className="flex h-[200px] items-center justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : groups.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">
                No icons match &ldquo;{debouncedQuery}&rdquo; in any set.
              </p>
            ) : (
              <div className="space-y-4">
                {groups.map((group) => (
                  <div key={group.prefix} className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {CMS_ICON_SET_LABELS[group.prefix]}
                    </p>
                    <div className="grid grid-cols-8 gap-2 sm:grid-cols-12">
                      {group.icons.map((icon) => (
                        <CmsIconButton
                          key={icon.key}
                          selection={{ key: icon.key, icon: { markup: icon.markup } }}
                          onSelect={handleSelect}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
