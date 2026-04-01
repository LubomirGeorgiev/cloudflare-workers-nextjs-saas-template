"use client";

import { useEffect, useState, useMemo } from "react";
import { useServerAction } from "zsa-react";
import { listCmsEntriesAction, deleteCmsEntryAction } from "../../../_actions/cms-entry-actions";
import { Button } from "@/components/ui/button";
import { Edit, Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { CmsEntryTags } from "@/components/cms-entry-tags";
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
import { type GetCmsCollectionResult } from "@/lib/cms/cms-repository";
import { CMS_STATUS_FILTER_ALL, type CmsStatusFilter } from "@/types/cms";
import { type CollectionsUnion } from "@/../cms.config";
import { CmsEntryStatusBadge } from "../../_components/cms-entry-status-badge";
import { Badge } from "@/components/ui/badge";
import { getCmsCollectionNavigationKey } from "@/lib/cms/cms-navigation-config";

export function CmsEntriesTable({
  collection,
  navigationEntryIds = [],
}: {
  collection: CollectionsUnion;
  navigationEntryIds?: string[];
}) {
  const [statusFilter, setStatusFilter] = useState<CmsStatusFilter>(CMS_STATUS_FILTER_ALL);
  const [deleteEntryId, setDeleteEntryId] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const docsNavigationEntryIdsSet = useMemo(
    () => new Set(navigationEntryIds),
    [navigationEntryIds]
  );
  const hasNavigation = Boolean(getCmsCollectionNavigationKey(collection));

  const { execute: listEntries, data, isPending } = useServerAction(listCmsEntriesAction);
  const { execute: deleteEntry, isPending: isDeleting } = useServerAction(deleteCmsEntryAction, {
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

  const columns: ColumnDef<GetCmsCollectionResult>[] = useMemo(() => [
    {
      accessorKey: "title",
      header: "Title",
      cell: ({ row }) => {
        const isEntryMissingNavigation =
          hasNavigation && !docsNavigationEntryIdsSet.has(row.original.id);

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
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <div className="flex flex-col gap-1">
          <CmsEntryStatusBadge status={row.original.status} />
          {(row.original.publishedAt && row.original.status === "scheduled") && (
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(row.original.publishedAt), { addSuffix: true })}
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
            ? formatDistanceToNow(new Date(row.original.updatedAt), { addSuffix: true })
            : "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: () => <div className="text-right">Actions</div>,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" asChild>
            <a href={`/admin/cms/${collection}/${row.original.id}`}>
              <Edit className="h-4 w-4" />
            </a>
          </Button>
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
  ], [collection, docsNavigationEntryIdsSet, hasNavigation, setDeleteEntryId]);

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

  const entries = data?.entries ?? [];
  const totalCount = data?.totalCount ?? 0;
  const pageCount = Math.ceil(totalCount / pageSize);

  return (
    <>
      {isPending ? (
        <div className="flex items-center justify-center py-8">
          <div className="text-sm text-muted-foreground">Loading entries...</div>
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
              This action cannot be undone. This will permanently delete this entry.
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
