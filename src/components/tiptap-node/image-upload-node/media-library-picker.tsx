"use client";

import { useState, useEffect } from "react";
import { useServerAction } from "zsa-react";
import { listCmsMediaForPickerAction } from "@/actions/list-cms-media.action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, ImageIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { CMS_IMAGES_API_ROUTE } from "@/constants";
import Image from "next/image";

interface MediaLibraryPickerProps {
  onSelect: (url: string, alt?: string, width?: number, height?: number) => void;
  onCancel: () => void;
}

export function MediaLibraryPicker({ onSelect, onCancel }: MediaLibraryPickerProps) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const { execute, data, isPending } = useServerAction(listCmsMediaForPickerAction);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1); // Reset to first page on search
    }, 300);

    return () => clearTimeout(timer);
  }, [search]);

  // Fetch media when search or page changes
  useEffect(() => {
    execute({
      page,
      limit: 20,
      search: debouncedSearch || undefined,
    });
  }, [page, debouncedSearch, execute]);

  const handleSelect = (media: {
    bucketKey: string;
    alt: string | null;
    width: number | null;
    height: number | null;
  }) => {
    const url = `${CMS_IMAGES_API_ROUTE}/${media.bucketKey}`;
    onSelect(
      url,
      media.alt || undefined,
      media.width || undefined,
      media.height || undefined
    );
  };

  return (
    <div className="tiptap-media-library-picker">
      <div className="tiptap-media-library-header">
        <h3 className="text-lg font-semibold">Choose from Media Library</h3>
        <div className="tiptap-media-library-search">
          <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            type="text"
            placeholder="Search by filename or alt text..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      <div className="tiptap-media-library-grid">
        {isPending ? (
          // Loading skeletons
          Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="tiptap-media-library-item-skeleton" />
          ))
        ) : data?.media && data.media.length > 0 ? (
          // Media grid
          data.media.map((media) => {
            const imageUrl = `${CMS_IMAGES_API_ROUTE}/${media.bucketKey}`;
            return (
              <button
                key={media.id}
                type="button"
                className="tiptap-media-library-item"
                onClick={() => handleSelect(media)}
                title={media.fileName}
              >
                <div className="tiptap-media-library-item-preview">
                  {media.mimeType.startsWith("image/") ? (
                    <Image
                      src={imageUrl}
                      alt={media.alt || media.fileName}
                      width={media.width || 200}
                      height={media.height || 200}
                      className="object-cover w-full h-full"
                    />
                  ) : (
                    <div className="tiptap-media-library-item-icon">
                      <ImageIcon className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="tiptap-media-library-item-info">
                  <span className="tiptap-media-library-item-name">
                    {media.fileName}
                  </span>
                  {media.width && media.height && (
                    <span className="tiptap-media-library-item-dimensions">
                      {media.width} × {media.height}
                    </span>
                  )}
                </div>
              </button>
            );
          })
        ) : (
          // No results
          <div className="tiptap-media-library-empty">
            <ImageIcon className="h-12 w-12 text-muted-foreground" />
            <p className="text-muted-foreground">
              {search ? "No media found matching your search" : "No media files available"}
            </p>
          </div>
        )}
      </div>

      <div className="tiptap-media-library-footer">
        <div className="tiptap-media-library-pagination">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || isPending}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={!data?.media || data.media.length < 20 || isPending}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
