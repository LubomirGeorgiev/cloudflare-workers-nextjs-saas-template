import { listCmsMediaAction } from "@/app/(admin)/admin/_actions/cms-media-actions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Eye, FileImage } from "lucide-react";
import { CMS_IMAGES_API_ROUTE } from "@/constants";
import Image from "next/image";
import { MediaTableActions } from "./media-table-actions";

interface MediaListTableProps {
  page: number;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export async function MediaListTable({ page }: MediaListTableProps) {
  const { data: result, serverError } = await listCmsMediaAction({ page, limit: 20 });

  if (serverError) {
    return (
      <div className="text-center py-8 text-destructive">
        Error loading media: {serverError.message}
      </div>
    );
  }

  if (!result || result.media.length === 0) {
    return (
      <div className="text-center py-12">
        <FileImage className="mx-auto h-12 w-12 text-muted-foreground" />
        <h3 className="mt-4 text-lg font-semibold">No media files</h3>
        <p className="text-muted-foreground mt-2">
          Upload images through the CMS editor to see them here.
        </p>
      </div>
    );
  }

  const { media, pagination } = result;

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[80px]">Preview</TableHead>
            <TableHead>File Name</TableHead>
            <TableHead>Alt Text</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Usage</TableHead>
            <TableHead>Uploaded</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {media.map((item) => {
            const imageUrl = `${CMS_IMAGES_API_ROUTE}/${item.bucketKey}`;
            const isImage = item.mimeType.startsWith("image/");

            return (
              <TableRow key={item.id}>
                <TableCell>
                  <Link href={`/admin/cms/media/${item.id}`} className="block">
                    {isImage ? (
                      <div className="relative w-16 h-16 rounded overflow-hidden bg-muted transition-opacity hover:opacity-75 cursor-pointer">
                        <Image
                          src={imageUrl}
                          alt={item.alt || item.fileName}
                          fill
                          className="object-cover"
                          sizes="64px"
                        />
                      </div>
                    ) : (
                      <div className="w-16 h-16 rounded bg-muted flex items-center justify-center transition-opacity hover:opacity-75 cursor-pointer">
                        <FileImage className="h-8 w-8 text-muted-foreground" />
                      </div>
                    )}
                  </Link>
                </TableCell>
                <TableCell className="font-medium">
                  <Link
                    href={`/admin/cms/media/${item.id}`}
                    className="hover:underline"
                  >
                    {item.fileName}
                  </Link>
                </TableCell>
                <TableCell className="max-w-xs truncate">
                  {item.alt ? (
                    <span className="text-sm">{item.alt}</span>
                  ) : (
                    <span className="text-sm text-muted-foreground italic">No alt text</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{item.mimeType}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatFileSize(item.sizeInBytes)}
                </TableCell>
                <TableCell>
                  {item.usageCount > 0 ? (
                    <Badge variant="secondary">
                      {item.usageCount} {item.usageCount === 1 ? "entry" : "entries"}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground text-sm">Unused</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" size="icon" asChild>
                      <Link href={`/admin/cms/media/${item.id}`}>
                        <Eye className="h-4 w-4" />
                      </Link>
                    </Button>
                    <MediaTableActions mediaId={item.id} usageCount={item.usageCount} />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {pagination.page} of {pagination.pages} ({pagination.total} total)
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page === 1}
              asChild={pagination.page > 1}
            >
              {pagination.page > 1 ? (
                <Link href={`/admin/cms/media?page=${pagination.page - 1}`}>
                  Previous
                </Link>
              ) : (
                <span>Previous</span>
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page === pagination.pages}
              asChild={pagination.page < pagination.pages}
            >
              {pagination.page < pagination.pages ? (
                <Link href={`/admin/cms/media?page=${pagination.page + 1}`}>
                  Next
                </Link>
              ) : (
                <span>Next</span>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
