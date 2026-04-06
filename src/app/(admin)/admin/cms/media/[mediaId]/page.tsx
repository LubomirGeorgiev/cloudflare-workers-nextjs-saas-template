import { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCmsMediaDetailsAction } from "@/app/(admin)/admin/_actions/cms-media-actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink, FileText } from "lucide-react";
import { CMS_IMAGES_API_ROUTE } from "@/constants";
import Image from "next/image";
import { EditAltText } from "./_components/edit-alt-text";
import { cmsConfig, type CollectionsUnion } from "@/../cms.config";
import { CmsEntryStatusBadge } from "../../_components/cms-entry-status-badge";

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
  const { data: result, serverError } = await getCmsMediaDetailsAction({ mediaId });

  if (serverError || !result) {
    notFound();
  }

  const { media, relatedEntries } = result;
  const imageUrl = `${CMS_IMAGES_API_ROUTE}/${media.bucketKey}`;
  const isImage = media.mimeType.startsWith("image/");

  // Group entries by collection
  const entriesByCollection = relatedEntries.reduce((acc, entry) => {
    if (!acc[entry.collection]) {
      acc[entry.collection] = [];
    }
    acc[entry.collection].push(entry);
    return acc;
  }, {} as Record<string, typeof relatedEntries>);

  const totalEntries = relatedEntries.length;

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
            This media file is used in {totalEntries} {totalEntries === 1 ? "entry" : "entries"} across{" "}
            {Object.keys(entriesByCollection).length} {Object.keys(entriesByCollection).length === 1 ? "collection" : "collections"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {Object.keys(entriesByCollection).length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">
              This media file is not used in any entries yet.
            </p>
          ) : (
            <div className="space-y-6">
              {Object.entries(entriesByCollection).map(([collectionSlug, entries]) => {
                const collection = cmsConfig.collections[collectionSlug as CollectionsUnion];
                const collectionName = collection?.labels.plural || collectionSlug;

                return (
                  <div key={collectionSlug} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">{collectionName}</h3>
                      <Badge variant="secondary">{entries.length} {entries.length === 1 ? "entry" : "entries"}</Badge>
                    </div>
                    <div className="space-y-2">
                      {entries.map((entry) => (
                        <Link
                          key={entry.id}
                          href={`/admin/cms/${collectionSlug}/${entry.id}`}
                          className="flex items-center gap-2 rounded-md border p-3 text-sm transition-colors hover:bg-muted"
                        >
                          <FileText className="h-4 w-4 text-muted-foreground" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{entry.title}</p>
                            <p className="text-xs text-muted-foreground truncate">/{entry.slug}</p>
                          </div>
                          <CmsEntryStatusBadge status={entry.status} />
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
