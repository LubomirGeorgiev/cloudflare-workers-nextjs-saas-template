"use client";

import { useEffect, useCallback, useMemo, useRef, useState, MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { formatDistanceToNow } from "date-fns";
import { createCmsEntryAction, updateCmsEntryAction, generateSeoDescriptionAction } from "../../../_actions/cms-entry-actions";
import { listCmsTagsAction, createCmsTagAction } from "../../../_actions/cms-tag-actions";
import { cmsEntryFormSchema, type CmsEntryFormData } from "@/schemas/cms-entry.schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
  FormLabel,
  FormDescription,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MultiSelect, type MultiSelectRef } from "@/components/ui/multi-select";
import type { MultiSelectOption } from "@/components/ui/multi-select";
import { SimpleEditor } from "@/components/tiptap-templates/simple/simple-editor";
import { Loader2, Save, Plus, ArrowLeft, WandSparkles } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import Link from "next/link";
import { toast } from "sonner";
import { generateSlug } from "@/utils/slugify";
import type { GetCmsCollectionResult } from "@/lib/cms/cms-repository";
import { CMS_ENTRY_STATUS } from "@/app/enums";
import useBeforeUnload from "@/hooks/use-before-unload";
import { SITE_URL, CMS_SEO_DESCRIPTION_MAX_LENGTH } from "@/constants";
import { Route } from "next";
import { cmsConfig, type CollectionsUnion } from "@/../cms.config";
import { zodSchemaToFieldConfigs } from "@/lib/cms/zod-to-field-config";
import { CmsDynamicField } from "./cms-dynamic-field";
import { CMS_ENTRY_STATUS_CONFIG } from "@/lib/cms/cms-entry-status-config";
import { FeaturedImageUpload } from "./featured-image-upload";
import { VersionHistory } from "./version-history";
import { History } from "lucide-react";
import { formatDateTime } from "@/utils/format-date";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getCmsCollectionNavigationKey } from "@/lib/cms/cms-navigation-config";

type CmsEntryFormProps = {
  collection: string;
  navigationPublicUrl?: Route | null;
  mode: "create" | "edit";
  entry?: GetCmsCollectionResult;
  pageTitle: string;
  pageSubtitle: string;
};

export function CmsEntryForm({
  collection,
  navigationPublicUrl = null,
  mode,
  entry,
  pageTitle,
  pageSubtitle,
}: CmsEntryFormProps) {
  const collectionConfig = cmsConfig.collections[collection as CollectionsUnion];
  const router = useRouter();
  const multiSelectRef = useRef<MultiSelectRef>(null);
  const isSlugManuallyEditedRef = useRef(false);

  // Get field configurations from the Zod schema
  const collectionDefinition = cmsConfig.collections[collection as CollectionsUnion];
  const customFields = useMemo(() => {
    if (
      !collectionDefinition ||
      !("fieldsSchema" in collectionDefinition) ||
      !collectionDefinition.fieldsSchema
    ) {
      return [];
    }
    return zodSchemaToFieldConfigs(collectionDefinition.fieldsSchema);
  }, [collectionDefinition]);

  // Initialize default field values
  const defaultFieldValues = useMemo(() => {
    const fields: Record<string, unknown> = (entry?.fields as Record<string, unknown>) || {};

    // Set default values for any missing fields
    for (const field of customFields) {
      if (!(field.name in fields) && field.defaultValue !== undefined) {
        fields[field.name] = field.defaultValue;
      }
    }

    return fields;
  }, [customFields, entry?.fields]);

  const form = useForm<CmsEntryFormData>({
    resolver: zodResolver(cmsEntryFormSchema),
    defaultValues: {
      title: entry?.title || "",
      slug: entry?.slug || "",
      content: entry?.content || { type: "doc", content: [] },
      seoDescription: entry?.seoDescription || "",
      status: entry?.status || (mode === "create" ? CMS_ENTRY_STATUS.DRAFT : undefined),
      publishedAt: entry?.publishedAt ? new Date(entry.publishedAt) : undefined,
      tagIds: entry?.tags?.map((t) => t.tag.id) || [],
      fields: defaultFieldValues,
      featuredImageId: entry?.featuredImageId || undefined,
    },
  });

  const statusValue = form.watch("status");

  const { execute: createEntry, isExecuting: isCreating } = useAction(createCmsEntryAction, {
    onError: ({ error }) => {
      toast.dismiss();
      toast.error(error.serverError?.message || "Failed to create entry");
    },
    onExecute: () => {
      toast.loading(mode === "create" ? "Creating entry..." : "Updating entry...");
    },
    onSuccess: () => {
      toast.dismiss();
      toast.success(mode === "create" ? "Entry created successfully" : "Entry updated successfully");
      router.push(`/admin/cms/${collection}`);
    },
  });

  const { execute: updateEntry, isExecuting: isUpdating } = useAction(updateCmsEntryAction, {
    onError: ({ error }) => {
      toast.dismiss();
      toast.error(error.serverError?.message || "Failed to update entry");
    },
    onExecute: () => {
      toast.loading("Updating entry...");
    },
    onSuccess: () => {
      toast.dismiss();
      toast.success("Entry updated successfully");
      router.push(`/admin/cms/${collection}`);
    },
  });

  const { execute: loadTags, result: tagsResult, isExecuting: isLoadingTags } = useAction(listCmsTagsAction);
  const { execute: createTag, isExecuting: isCreatingTag } = useAction(createCmsTagAction, {
    onSuccess: ({ data }) => {
      if (data) {
        toast.success(`Tag "${data.name}" created successfully`);
        loadTags(); // Refresh tags list
        const currentTagIds = form.getValues("tagIds") || [];
        form.setValue("tagIds", [...currentTagIds, data.id]);
        setSearchValue("");
        multiSelectRef.current?.closePopover();
      }
    },
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Failed to create tag");
    },
  });
  const { execute: generateSeoDescription, isExecuting: isGeneratingSeo } = useAction(generateSeoDescriptionAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Failed to generate SEO description");
    },
    onSuccess: ({ data }) => {
      if (data?.description) {
        form.setValue("seoDescription", data.description);
        toast.success("SEO description generated successfully");
      }
    },
  });

  const [isVersionHistoryOpen, setIsVersionHistoryOpen] = useState(false);

  const isExecuting = isCreating || isUpdating;

  const [searchValue, setSearchValue] = useState("");

  useEffect(() => {
    loadTags();
  }, [loadTags]);

  const availableTags = tagsResult.data || [];

  const isDirty = form.formState.isDirty;

  useBeforeUnload(() => isDirty && !isExecuting);

  const handleNavigateBack = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    if (isDirty && !isExecuting) {
      const confirmed = window.confirm(
        "You have unsaved changes. Are you sure you want to leave?"
      );
      if (!confirmed) {
        e?.preventDefault();
        return;
      }
    }
    router.push(`/admin/cms/${collection}`);
  }, [isDirty, isExecuting, router, collection]);

  const handleTitleChange = (value: string) => {
    form.setValue("title", value);
    if (mode === "create" && !isSlugManuallyEditedRef.current) {
      const generatedSlug = generateSlug(value);
      form.setValue("slug", generatedSlug);
    }
  };

  const handleSlugChange = (value: string) => {
    form.setValue("slug", value);
    if (!isSlugManuallyEditedRef.current) {
      isSlugManuallyEditedRef.current = true;
    }
  };

  const handleGenerateSeoDescription = useCallback(() => {
    if (!entry?.id) {
      toast.error("Please save the entry first before generating SEO description");
      return;
    }

    generateSeoDescription({
      id: entry.id,
    });
  }, [entry?.id, generateSeoDescription]);

  const tagOptions: MultiSelectOption[] = useMemo(
    () =>
      availableTags.map((tag: { id: string; name: string; color: string | null }) => ({
        label: tag.name,
        value: tag.id,
        style: {
          badgeColor: tag.color ? `${tag.color}20` : undefined,
        },
      })),
    [availableTags]
  );

  const handleCreateTag = useCallback(
    (tagName: string) => {
      if (!tagName.trim()) return;

      const slug = generateSlug(tagName);

      createTag({
        name: tagName.trim(),
        slug,
        description: "",
        color: undefined,
      });
    },
    [createTag]
  );

  const hasExactMatch = useMemo(
    () =>
      tagOptions.some(
        (option) => option.label.toLowerCase() === searchValue.toLowerCase()
      ),
    [tagOptions, searchValue]
  );

  const emptyIndicator = useMemo(() => {
    if (searchValue && !hasExactMatch) {
      return (
        <div className="text-center py-6">
          <p className="text-sm text-muted-foreground mb-3">
            No tag found for &quot;{searchValue}&quot;
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleCreateTag(searchValue)}
            disabled={isCreatingTag}
            className="mx-auto"
          >
            {isCreatingTag ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Creating...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                Create &quot;{searchValue}&quot;
              </>
            )}
          </Button>
        </div>
      );
    }

    return (
      <div className="text-center py-6 text-sm text-muted-foreground">
        No tags found.
      </div>
    );
  }, [searchValue, hasExactMatch, isCreatingTag, handleCreateTag]);

  const currentSlug = form.watch("slug");
  const navigationKey = getCmsCollectionNavigationKey(collection as CollectionsUnion);
  const previewUrlBuilder = "previewUrl" in collectionConfig ? collectionConfig.previewUrl : undefined;
  const previewUrl = navigationKey
    ? navigationPublicUrl
    : currentSlug?.trim() && previewUrlBuilder
      ? (previewUrlBuilder(currentSlug) as Route)
      : null;
  const showNavigationAlert = mode === "edit" && Boolean(navigationKey) && !previewUrl;
  const navigationAlert = showNavigationAlert ? (
    <Alert>
      <AlertTitle>No public URL</AlertTitle>
      <AlertDescription>
        <span>
          This entry is not added to navigation yet, so it does not have a public URL.{" "}
          <Link
            href={`/admin/cms/navigation/${navigationKey}`}
            className="underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Add it in Navigation
          </Link>
          .
        </span>
      </AlertDescription>
    </Alert>
  ) : null;

  const onSubmit = async (data: CmsEntryFormData) => {
    // Serialize content to prevent Next.js from converting attrs to functions
    const serializedContent = JSON.parse(JSON.stringify(data.content));

    // Clean up custom fields before submitting
    // Build a complete fields object with all defined fields from the schema
    const cleanedFields: Record<string, unknown> = {};

    // Process all fields defined in the schema
    for (const fieldConfig of customFields) {
      const value = data.fields?.[fieldConfig.name];

      if (fieldConfig.type === "number") {
        // Convert empty string or NaN to undefined, otherwise parse as number
        const strValue = String(value);
        if (strValue === "" || strValue === "NaN" || value === undefined) {
          // Only include if not optional, otherwise omit
          if (fieldConfig.required) {
            cleanedFields[fieldConfig.name] = undefined;
          }
        } else {
          const numValue = Number(value);
          cleanedFields[fieldConfig.name] = isNaN(numValue) ? undefined : numValue;
        }
      } else if (fieldConfig.type === "date") {
        // Convert empty string to undefined, otherwise ensure it's a Date object
        if (value === "" || value === null || value === undefined) {
          // Only include if not optional, otherwise omit
          if (fieldConfig.required) {
            cleanedFields[fieldConfig.name] = undefined;
          }
        } else {
          cleanedFields[fieldConfig.name] = value instanceof Date ? value : new Date(value as string);
        }
      } else {
        // For string/textarea, omit empty strings for optional fields
        if (value === "" || value === undefined) {
          // Only include if not optional, otherwise omit
          if (fieldConfig.required) {
            cleanedFields[fieldConfig.name] = undefined;
          }
        } else {
          cleanedFields[fieldConfig.name] = value;
        }
      }
    }

    if (mode === "create") {
      await createEntry({
        ...data,
        // oxlint-disable-next-line typescript/no-explicit-any
        collection: collection as any,
        content: serializedContent,
        fields: cleanedFields,
        tagIds: data.tagIds || [],
      });
    } else {
      if (!entry) return;

      await updateEntry({
        ...data,
        id: entry.id,
        content: serializedContent,
        fields: cleanedFields,
        tagIds: data.tagIds || [],
      });
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleNavigateBack}
              disabled={isExecuting}
              asChild
            >
              <span>
                <ArrowLeft className="h-4 w-4" />
              </span>
            </Button>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                {pageTitle}
              </h1>
              <p className="text-muted-foreground mt-2">{pageSubtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {mode === "edit" && entry && (
               <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsVersionHistoryOpen(true)}
                  disabled={isExecuting}
                >
                  <History className="h-4 w-4 mr-2" />
                  History
                </Button>
                <VersionHistory
                  entryId={entry.id}
                  currentVersion={entry}
                  isOpen={isVersionHistoryOpen}
                  onOpenChange={setIsVersionHistoryOpen}
                />
               </>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={handleNavigateBack}
              disabled={isExecuting}
              asChild
            >
              <span>
                Cancel
              </span>
            </Button>
            <Button type="submit" disabled={isExecuting}>
              {isExecuting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {mode === "create" ? "Creating..." : "Saving..."}
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  {mode === "create" ? "Create Entry" : "Save Changes"}
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="contents lg:flex lg:flex-col lg:col-span-3 lg:gap-6">
            <div className="order-1">
              {navigationAlert && (
                <div className="mb-6">
                  {navigationAlert}
                </div>
              )}
              <Card>
                <CardHeader>
                  <CardTitle>Basic Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Title *</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="Enter a compelling title..."
                            className="text-lg"
                            onChange={(e) => {
                              field.onChange(e);
                              handleTitleChange(e.target.value);
                            }}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="slug"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {navigationKey ? "Entry Slug *" : "URL Slug *"}
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="url-friendly-slug"
                            onChange={(e) => {
                              field.onChange(e);
                              handleSlugChange(e.target.value);
                            }}
                          />
                        </FormControl>
                        <FormDescription>
                          {navigationKey ? (
                            <>
                              Internal identifier for this entry. The public URL is controlled from{" "}
                              <Link
                                href={`/admin/cms/navigation/${navigationKey}`}
                                className="underline hover:text-foreground"
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                Navigation
                              </Link>
                              .
                            </>
                          ) : (
                            "This will be used in the URL. Auto-generated from title, but you can customize it."
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="seoDescription"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>SEO Description</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Textarea
                              {...field}
                              placeholder={`Enter SEO meta description (max ${CMS_SEO_DESCRIPTION_MAX_LENGTH} characters)...`}
                              className="pr-10"
                              maxLength={CMS_SEO_DESCRIPTION_MAX_LENGTH}
                              rows={3}
                            />
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="absolute right-2 top-2 h-8 w-8"
                                    onClick={handleGenerateSeoDescription}
                                    disabled={isGeneratingSeo || !entry?.id}
                                  >
                                    {isGeneratingSeo ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <WandSparkles className="h-4 w-4" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Auto-generate SEO description using AI</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        </FormControl>
                        <FormDescription>
                          Meta description for search engines (max {CMS_SEO_DESCRIPTION_MAX_LENGTH} characters). Leave empty to auto-generate on save.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            </div>

            {customFields.length > 0 && (
              <div className="order-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Custom Fields</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {customFields.map((field) => (
                      <CmsDynamicField key={field.name} field={field} />
                    ))}
                  </CardContent>
                </Card>
              </div>
            )}

            <div className="order-3">
              <FormField
                control={form.control}
                name="content"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Content</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <SimpleEditor
                          content={field.value}
                          onChange={(newContent) => field.onChange(newContent)}
                          collection={collection}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          <div className="space-y-6 order-2 lg:order-2">
            <Card>
              <CardHeader>
                <CardTitle>Featured Image</CardTitle>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="featuredImageId"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <FeaturedImageUpload
                          collection={collection}
                          value={field.value}
                          featuredImage={entry?.featuredImage}
                          featuredImageUrl={entry?.featuredImageUrl}
                          onChange={field.onChange}
                        />
                      </FormControl>
                      <FormDescription>
                        Upload a featured image for this entry (recommended: 1200x630px)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Publishing</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select
                        onValueChange={(value) => {
                          field.onChange(value);
                          // Clear publishedAt when changing away from scheduled
                          if (value !== CMS_ENTRY_STATUS.SCHEDULED) {
                            form.setValue("publishedAt", undefined);
                          }
                        }}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {CMS_ENTRY_STATUS_CONFIG.map((status) => (
                            <SelectItem key={status.value} value={status.value}>
                              <div className="flex items-center gap-2">
                                <div className={`h-2 w-2 rounded-full ${status.color}`} />
                                <span>{status.label}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Control the visibility of this entry
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {statusValue === CMS_ENTRY_STATUS.SCHEDULED && (
                  <FormField
                    control={form.control}
                    name="publishedAt"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Publish Date & Time *</FormLabel>
                        <FormControl>
                          <Input
                            type="datetime-local"
                            value={
                              field.value
                                ? new Date(field.value.getTime() - field.value.getTimezoneOffset() * 60000)
                                    .toISOString()
                                    .slice(0, 16)
                                : ""
                            }
                            onChange={(e) => {
                              const dateValue = e.target.value
                                ? new Date(e.target.value)
                                : new Date(Date.now() + 5 * 60 * 1000);
                              field.onChange(dateValue);
                            }}
                            min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                          />
                        </FormControl>
                        <FormDescription>
                          Entry will be automatically published at this date and time
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Tags</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="tagIds"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Select Tags</FormLabel>
                      <FormControl>
                        <MultiSelect
                          ref={multiSelectRef}
                          options={tagOptions}
                          onValueChange={field.onChange}
                          defaultValue={field.value || []}
                          placeholder="Select tags..."
                          variant="default"
                          maxCount={3}
                          disabled={isLoadingTags || isCreatingTag}
                          className="w-full"
                          searchable={true}
                          onSearchChange={setSearchValue}
                          emptyIndicator={emptyIndicator}
                          resetOnDefaultValueChange={true}
                        />
                      </FormControl>
                      <FormDescription>
                        Type to search or create new tags.{" "}
                        <a
                          href="/admin/cms/tags"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-foreground"
                        >
                          Manage tags
                        </a>
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {mode === "edit" && entry && (
              <Card>
                <CardHeader>
                  <CardTitle>Entry Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Created:</span>
                    <p className="font-medium">
                      {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatDateTime(entry.createdAt)}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Last Updated:</span>
                    <p className="font-medium">
                      {formatDistanceToNow(new Date(entry.updatedAt), { addSuffix: true })}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatDateTime(entry.updatedAt)}
                    </p>
                  </div>
                  {entry.publishedAt && (
                    <div>
                      <span className="text-muted-foreground">
                        {entry.status === CMS_ENTRY_STATUS.SCHEDULED ? "Scheduled for:" : "Published:"}
                      </span>
                      <p className="font-medium">
                        {formatDistanceToNow(new Date(entry.publishedAt), { addSuffix: true })}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatDateTime(entry.publishedAt)}
                      </p>
                    </div>
                  )}
                  {previewUrl && (
                    <div>
                      <span className="text-muted-foreground mr-2">Preview:</span>
                      <div>
                        <Link href={previewUrl} className="underline" target="_blank" rel="noopener noreferrer">
                          {SITE_URL}{previewUrl}
                        </Link>
                      </div>
                    </div>
                  )}
                  {navigationAlert}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </form>
    </Form>
  );
}
