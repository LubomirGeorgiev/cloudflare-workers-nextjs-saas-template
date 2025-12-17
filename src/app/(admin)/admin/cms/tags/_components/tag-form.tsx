"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useServerAction } from "zsa-react";
import { createCmsTagAction, updateCmsTagAction, deleteCmsTagAction } from "../../../_actions/cms-tag-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { generateSlug } from "@/utils/slugify";
import type { CmsTag } from "@/db/schema";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type TagFormProps = {
  mode: "create" | "edit";
  tag?: CmsTag;
};

export function TagForm({ mode, tag }: TagFormProps) {
  const router = useRouter();
  const [name, setName] = useState(tag?.name || "");
  const [slug, setSlug] = useState(tag?.slug || "");
  const [isSlugManuallyEdited, setIsSlugManuallyEdited] = useState(false);
  const [description, setDescription] = useState(tag?.description || "");
  const [color, setColor] = useState(tag?.color || "#000000");

  const { execute: createTag, isPending: isCreating } = useServerAction(createCmsTagAction);
  const { execute: updateTag, isPending: isUpdating } = useServerAction(updateCmsTagAction);
  const { execute: deleteTag, isPending: isDeleting } = useServerAction(deleteCmsTagAction);

  const isPending = isCreating || isUpdating || isDeleting;

  const handleNameChange = (value: string) => {
    setName(value);
    if (mode === "create" && !isSlugManuallyEdited) {
      const generatedSlug = generateSlug(value);
      setSlug(generatedSlug);
    }
  };

  const handleSlugChange = (value: string) => {
    setSlug(value);
    if (!isSlugManuallyEdited) {
      setIsSlugManuallyEdited(true);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name || !slug) {
      toast.error("Name and slug are required");
      return;
    }

    if (mode === "create") {
      const [data, error] = await createTag({
        name,
        slug,
        description,
        color,
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      if (data) {
        toast.success("Tag created successfully");
        router.push("/admin/cms/tags");
      }
    } else {
      if (!tag) return;

      const [data, error] = await updateTag({
        id: tag.id,
        name,
        slug,
        description,
        color,
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      if (data) {
        toast.success("Tag updated successfully");
        router.push("/admin/cms/tags");
      }
    }
  };

  const handleDelete = async () => {
    if (!tag) return;

    const [data, error] = await deleteTag({ id: tag.id });

    if (error) {
      toast.error(error.message);
      return;
    }

    if (data) {
      toast.success("Tag deleted successfully");
      router.push("/admin/cms/tags");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Tag Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Technology"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="slug">Slug *</Label>
            <Input
              id="slug"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder="e.g. technology"
              required
            />
            <p className="text-xs text-muted-foreground">
              Auto-generated from name, but you can customize it
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="color">Color</Label>
            <div className="flex gap-2">
              <Input
                id="color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-12 h-10 p-1 cursor-pointer"
              />
              <Input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#000000"
                className="flex-1"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description for this tag"
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button type="submit" disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                {mode === "create" ? "Creating..." : "Updating..."}
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                {mode === "create" ? "Create Tag" : "Update Tag"}
              </>
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/admin/cms/tags")}
            disabled={isPending}
          >
            Cancel
          </Button>
        </div>

        {mode === "edit" && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" type="button" disabled={isPending}>
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete the tag
                  and remove it from all associated entries.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </form>
  );
}
