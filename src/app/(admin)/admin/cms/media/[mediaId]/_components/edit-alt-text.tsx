"use client";

import { useState } from "react";
import { useServerAction } from "zsa-react";
import { updateCmsMediaAction } from "@/app/(admin)/admin/_actions/cms-media-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pencil, Check, X, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface EditAltTextProps {
  mediaId: string;
  currentAlt: string | null;
}

export function EditAltText({ mediaId, currentAlt }: EditAltTextProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [altText, setAltText] = useState(currentAlt || "");
  const router = useRouter();

  const { execute, isPending } = useServerAction(updateCmsMediaAction, {
    onSuccess: () => {
      toast.success("Alt text updated successfully");
      setIsEditing(false);
      router.refresh();
    },
    onError: ({ err }) => {
      toast.error(err.message || "Failed to update alt text");
    },
  });

  const handleSave = async () => {
    await execute({
      mediaId,
      alt: altText.trim() || undefined,
    });
  };

  const handleCancel = () => {
    setAltText(currentAlt || "");
    setIsEditing(false);
  };

  if (!isEditing) {
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-sm font-medium text-muted-foreground">Alt Text</Label>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsEditing(true)}
            className="h-8 px-2"
          >
            <Pencil className="h-3 w-3 mr-1" />
            Edit
          </Button>
        </div>
        <p className="text-sm">
          {currentAlt || (
            <span className="text-muted-foreground italic">No alt text set</span>
          )}
        </p>
      </div>
    );
  }

  return (
    <div>
      <Label htmlFor="alt-text" className="text-sm font-medium text-muted-foreground">
        Alt Text
      </Label>
      <div className="flex gap-2 mt-2">
        <Input
          id="alt-text"
          value={altText}
          onChange={(e) => setAltText(e.target.value)}
          placeholder="Enter descriptive alt text..."
          disabled={isPending}
          className="flex-1"
        />
        <Button
          variant="outline"
          size="icon"
          onClick={handleSave}
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={handleCancel}
          disabled={isPending}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
