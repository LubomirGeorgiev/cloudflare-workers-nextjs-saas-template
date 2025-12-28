import { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCmsMediaDetailsAction } from "@/app/(admin)/admin/_actions/cms-media-actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { CMS_IMAGES_API_ROUTE } from "@/constants";
import Image from "next/image";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EditAltText } from "./_components/edit-alt-text";

export const metadata: Metadata = {
  title: "Media Details | Admin",
  description: "View media file details and usage",
};

interface MediaDetailPageProps {
  params: Promise<{
    mediaId: string;
  }>;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export default async function MediaDetailPage({ params }: MediaDetailPageProps) {
  const { mediaId } = await params;
  const [result, error] = await getCmsMediaDetailsAction({ mediaId });

  if (error || !result) {
    notFound();
  }

  const { media, relatedEntries } = result;
  const imageUrl = `${CMS_IMAGES_API_ROUTE}/${media.bucketKey}`;
  const isImage = media.mimeType.startsWith("image/");

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/cms/media">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Media Details</h1>
          <p className="text-muted-foreground mt-2">{media.fileName}</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Preview */}
        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
          </CardHeader>
          <CardContent>
            {isImage ? (
              <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-muted">
                <Image
                  src={imageUrl}
                  alt={media.alt || media.fileName}
                  fill
                  className="object-contain"
                  sizes="(max-width: 768px) 100vw, 50vw"
                />
              </div>
            ) : (
              <div className="w-full aspect-video rounded-lg bg-muted flex items-center justify-center">
                <p className="text-muted-foreground">No preview available</p>
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href={imageUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open in New Tab
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Metadata */}
        <Card>
          <CardHeader>
            <CardTitle>File Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">File Name</p>
              <p className="mt-1">{media.fileName}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Type</p>
              <Badge variant="outline" className="mt-1">{media.mimeType}</Badge>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Size</p>
              <p className="mt-1">{formatFileSize(media.sizeInBytes)}</p>
            </div>
            {media.width && media.height && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">Dimensions</p>
                <p className="mt-1">{media.width} × {media.height} px</p>
              </div>
            )}
            <div>
              <EditAltText mediaId={media.id} currentAlt={media.alt} />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Uploaded</p>
              <p className="mt-1">
                {formatDistanceToNow(new Date(media.createdAt), { addSuffix: true })}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(media.createdAt).toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">R2 Key</p>
              <code className="mt-1 block text-xs bg-muted p-2 rounded">
                {media.bucketKey}
              </code>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Related Entries */}
      <Card>
        <CardHeader>
          <CardTitle>Used In Entries</CardTitle>
          <CardDescription>
            CMS entries that contain this media file
          </CardDescription>
        </CardHeader>
        <CardContent>
          {relatedEntries.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">
              This media file is not used in any entries yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Collection</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {relatedEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium">{entry.title}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{entry.collection}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{entry.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/admin/cms/${entry.collection}/${entry.id}`}>
                          View Entry
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
