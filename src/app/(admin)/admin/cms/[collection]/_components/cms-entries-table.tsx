"use client";

import { useEffect, useState, useMemo } from "react";
import { useAction } from "next-safe-action/hooks";
import {
  listCmsEntriesAction,
  type CmsEntryListRow,
  deleteCmsEntryAction,
} from "../../../_actions/cms-entry-actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Edit, Trash2 } from "lucide-react";
import { CmsEntryTags } from "@/components/cms-entry-tags";
import { formatRelativeDateTime } from "@/utils/format-date";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { DataTable } from "@/components/data-table";
import { type ColumnDef } from "@tanstack/react-table";
import { CMS_STATUS_FILTER_ALL, type CmsStatusFilter } from "@/types/cms";
import { type CollectionsUnion } from "@/../cms.config";
import { CmsEntryStatusBadge } from "../../_components/cms-entry-status-badge";
import { Badge } from "@/components/ui/badge";
import { getCmsCollectionNavigationKey } from "@/lib/cms/cms-navigation-config";
import { toast } from "sonner";
import { ENABLED_LOCALES, DEFAULT_LOCALE } from "@/i18n/config";
import { LocaleCoverageBadges } from "../../_components/locale-coverage-badges";

export function CmsEntriesTable({
  collection,
  navigationEntrySlugs = [],
}: {
  collection: CollectionsUnion;
  navigationEntrySlugs?: string[];
}) {
  const [statusFilter, setStatusFilter] = useState<CmsStatusFilter>(CMS_STATUS_FILTER_ALL);
  const [deleteEntryId, setDeleteEntryId] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  // Membership is keyed by the (collection, slug) translation group, so every locale
  // sibling of an attached entry counts as in-navigation.
  const docsNavigationSlugsSet = useMemo(
    () => new Set(navigationEntrySlugs),
    [navigationEntrySlugs]
  );
  const hasNavigation = Boolean(getCmsCollectionNavigationKey(collection));
  // With a single active locale (i18n disabled) translation coverage carries no
  // information, so drop it entirely.
  const showLocaleColumns = ENABLED_LOCALES.length > 1;

  const { execute: listEntries, result, isExecuting } = useAction(listCmsEntriesAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Failed to load entries");
    },
  });
  const { execute: deleteEntry, isExecuting: isDeleting } = useAction(deleteCmsEntryAction, {
    onError: ({ error }) => {
      toast.error(error.serverError?.message || "Failed to delete entry");
    },
    onSuccess: () => {
      listEntries({
        collection,
        status: statusFilter,
        limit: pageSize,
        offset: pageIndex * pageSize,
      });
      setDeleteEntryId(null);
    },
  });

  const columns: ColumnDef<CmsEntryListRow>[] = useMemo(() => [
    {
      accessorKey: "title",
      header: "Title",
      cell: ({ row }) => {
        const isEntryMissingNavigation =
          hasNavigation && !docsNavigationSlugsSet.has(row.original.slug);

        return (
          <div className="flex flex-col gap-1">
            <span className="font-medium">{row.original.title}</span>
            {isEntryMissingNavigation ? (
              <Badge variant="outline" className="w-fit text-amber-700 border-amber-300">
                Not in navigation
              </Badge>
            ) : null}
          </div>
        );
      },
    },
    {
      accessorKey: "slug",
      header: "Slug",
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.slug}</span>,
    },
    // Translation coverage only makes sense with more than one active locale;
    // with i18n disabled it is dropped entirely.
    ...(showLocaleColumns
      ? ([
          {
            id: "translations",
            header: "Translations",
            cell: ({ row }) => {
              // Group-wide coverage: missing enabled locales for this (collection, slug).
              const missing = new Set(row.original.missingLocales ?? []);
              const translatedLocales = new Set(
                ENABLED_LOCALES.filter((locale) => !missing.has(locale))
              );

              return (
                <LocaleCoverageBadges
                  translatedLocales={translatedLocales}
                  currentLocale={row.original.locale}
                />
              );
            },
          },
        ] as ColumnDef<CmsEntryListRow>[])
      : []),
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <div className="flex flex-col gap-1">
          <CmsEntryStatusBadge status={row.original.status} />
          {(row.original.publishedAt && row.original.status === "scheduled") && (
            <span className="text-xs text-muted-foreground">
              {formatRelativeDateTime(row.original.publishedAt)}
            </span>
          )}
        </div>
      ),
    },
    {
      id: "tags",
      header: "Tags",
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          <CmsEntryTags tags={row.original.tags} variant="outline" emptyText="—" />
        </div>
      ),
    },
    {
      id: "author",
      header: "Author",
      cell: ({ row }) => (
        <span>
          {row.original.createdByUser
            ? `${row.original.createdByUser.firstName || ""} ${row.original.createdByUser.lastName || ""}`.trim() ||
            row.original.createdByUser.email
            : "Unknown"}
        </span>
      ),
    },
    {
      accessorKey: "updatedAt",
      header: "Updated",
      cell: ({ row }) => (
        <span>
          {row.original.updatedAt
            ? formatRelativeDateTime(row.original.updatedAt)
            : "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: () => <div className="text-right">Actions</div>,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-2">
          <a
            href={`/admin/cms/${collection}/${row.original.id}`}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
              <Edit className="h-4 w-4" />
          </a>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeleteEntryId(row.original.id)}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ], [collection, docsNavigationSlugsSet, hasNavigation, showLocaleColumns, setDeleteEntryId]);

  useEffect(() => {
    listEntries({
      collection,
      status: statusFilter,
      limit: pageSize,
      offset: pageIndex * pageSize,
    });
  }, [collection, statusFilter, pageIndex, pageSize, listEntries]);

  const handleDelete = (id: string) => {
    deleteEntry({ id });
  };

  const data = result.data;
  const error = result.serverError;
  const entries = data?.entries ?? [];
  const totalCount = data?.totalCount ?? 0;
  const pageCount = Math.ceil(totalCount / pageSize);

  // Deleting the default-locale row deletes the whole translation group (navigation anchors on it and it is
  // the i18n fallback base), so warn when siblings would go with it. Sibling count comes from the row's
  // group-wide coverage (translationGroupSize), so it stays accurate even when siblings are off the loaded page or filtered out.
  const entryPendingDelete = deleteEntryId
    ? entries.find((entry) => entry.id === deleteEntryId) ?? null
    : null;
  const translationSiblingCount = entryPendingDelete
    ? Math.max(0, entryPendingDelete.translationGroupSize - 1)
    : 0;
  const willDeleteTranslationGroup =
    showLocaleColumns &&
    entryPendingDelete?.locale === DEFAULT_LOCALE &&
    translationSiblingCount > 0;

  return (
    <>
      {isExecuting ? (
        <div className="flex items-center justify-center py-8">
          <div className="text-sm text-muted-foreground">Loading entries...</div>
        </div>
      ) : error ? (
        <div className="flex items-center justify-center py-8">
          <div className="text-sm text-muted-foreground">{error.message}</div>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={entries}
          pageCount={pageCount}
          pageIndex={pageIndex}
          pageSize={pageSize}
          onPageChange={setPageIndex}
          onPageSizeChange={(newSize) => {
            setPageSize(newSize);
            setPageIndex(0);
          }}
          totalCount={totalCount}
          itemNameSingular="entry"
          itemNamePlural="entries"
          getRowHref={(row) => `/admin/cms/${collection}/${row.id}`}
          // Hovering one locale row highlights its translation siblings (same slug).
          getRowGroupKey={(row) => row.slug}
          excludeClickableColumns={["actions"]}
          filterComponents={(
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Filter by status:</span>
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  setStatusFilter(value as CmsStatusFilter);
                  setPageIndex(0);
                }}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CMS_STATUS_FILTER_ALL}>All</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        />
      )}

      <AlertDialog open={deleteEntryId !== null} onOpenChange={(open) => !open && setDeleteEntryId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone.{" "}
              {willDeleteTranslationGroup
                ? `This will permanently delete this entry and all ${translationSiblingCount} of its translation${translationSiblingCount === 1 ? "" : "s"}.`
                : "This will permanently delete this entry."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteEntryId && handleDelete(deleteEntryId)}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
