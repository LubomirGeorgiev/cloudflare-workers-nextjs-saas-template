"use client";

import { useState, useRef } from "react";
import { useAction } from "next-safe-action/hooks";
import { uploadImageAction } from "@/actions/upload-image.action";
import { getCmsMediaByBucketKeyAction } from "@/app/(admin)/admin/_actions/cms-media-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, Upload, X, ImageIcon, Library } from "lucide-react";
import { toast } from "sonner";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MediaLibraryPicker } from "@/components/tiptap-node/image-upload-node/media-library-picker";
import { CMS_IMAGES_API_ROUTE } from "@/constants";

interface FeaturedImageUploadProps {
  collection: string;
  value?: string | null; // mediaId
  featuredImage?: {
    id: string;
    fileName: string;
    bucketKey: string;
    alt: string | null;
    width: number | null;
    height: number | null;
  } | null;
  featuredImageUrl?: string | null;
  onChange: (mediaId: string | null) => void;
}

export function FeaturedImageUpload({
  collection,
  value: _value,
  featuredImage,
  featuredImageUrl,
  onChange,
}: FeaturedImageUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    featuredImageUrl || null
  );
  const [showMediaLibrary, setShowMediaLibrary] = useState(false);

  const { execute: uploadImage, isExecuting } = useAction(uploadImageAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Failed to upload image");
    },
    onSuccess: ({ data }) => {
      toast.success("Image uploaded successfully");
      if (data.mediaId && data.url) {
        onChange(data.mediaId);
        setPreviewUrl(data.url);
      }
    },
  });

  const { execute: getMediaByBucketKey, isExecuting: isLoadingMedia } = useAction(
    getCmsMediaByBucketKeyAction,
    {
      onError: ({ error }) => {
        toast.error(error.serverError?.message || "Failed to load media");
      },
      onSuccess: ({ data }) => {
        if (!data || data.length === 0) {
          toast.error("Media not found");
          return;
        }
        // Get the URL from the pending selection
        const bucketKey = data[0].bucketKey;
        const url = `${CMS_IMAGES_API_ROUTE}/${bucketKey}`;
        onChange(data[0].id);
        setPreviewUrl(url);
        setShowMediaLibrary(false);
        toast.success("Featured image selected");
      },
    }
  );

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    // Validate file size (10MB max)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error("Image must be smaller than 10MB");
      return;
    }

    await uploadImage({ file, collection });

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleRemove = () => {
    onChange(null);
    setPreviewUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleMediaLibrarySelect = (
    url: string,
    _alt?: string,
    _width?: number,
    _height?: number
  ) => {
    // Extract the bucket key from the URL
    const bucketKey = url.replace(/^\/api\/cms-images\//, "");

    // Find the media by bucket key to get the media ID
    // The result will be handled in the onSuccess callback
    getMediaByBucketKey({ bucketKey });
  };

  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
        disabled={isExecuting}
      />

      {previewUrl ? (
        <Card className="relative overflow-hidden">
          <div className="relative aspect-video w-full bg-muted">
            <Image
              src={previewUrl}
              alt={featuredImage?.alt || "Featured image"}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            />
          </div>
          <div className="absolute top-2 right-2 flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={handleUploadClick}
              disabled={isExecuting}
              className="h-8 w-8 bg-background/80 backdrop-blur-sm hover:bg-background/90"
              title="Upload new image"
            >
              {isExecuting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={() => setShowMediaLibrary(true)}
              disabled={isExecuting || isLoadingMedia}
              className="h-8 w-8 bg-background/80 backdrop-blur-sm hover:bg-background/90"
              title="Choose from library"
            >
              <Library className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="icon"
              onClick={handleRemove}
              disabled={isExecuting}
              className="h-8 w-8 bg-destructive/80 backdrop-blur-sm hover:bg-destructive/90"
              title="Remove image"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          <Card
            className="border-2 border-dashed hover:border-primary/50 transition-colors cursor-pointer"
            onClick={handleUploadClick}
          >
            <div className="flex flex-col items-center justify-center py-12 px-4">
              <div className="rounded-full bg-muted p-4 mb-4">
                <ImageIcon className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium mb-1">
                {isExecuting ? "Uploading..." : "Upload Featured Image"}
              </p>
              <p className="text-xs text-muted-foreground text-center">
                Click to select an image (max 10MB)
              </p>
              {isExecuting && (
                <Loader2 className="h-5 w-5 animate-spin mt-3 text-primary" />
              )}
            </div>
          </Card>
          <div className="flex items-center justify-center">
            <span className="text-xs text-muted-foreground px-2">or</span>
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setShowMediaLibrary(true)}
            disabled={isExecuting || isLoadingMedia}
          >
            <Library className="h-4 w-4 mr-2" />
            Choose from Media Library
          </Button>
        </div>
      )}

      <Dialog open={showMediaLibrary} onOpenChange={setShowMediaLibrary}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Select Featured Image</DialogTitle>
            <DialogDescription>
              Choose an image from your media library
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-hidden">
            <MediaLibraryPicker
              onSelect={handleMediaLibrarySelect}
              onCancel={() => setShowMediaLibrary(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
