import { Metadata } from "next";
import { Suspense } from "react";
import { MediaListTable } from "./_components/media-list-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Media Library | Admin",
  description: "Manage uploaded media files",
};

export default async function MediaLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Number(pageParam) || 1;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Media Library</h1>
        <p className="text-muted-foreground mt-2">
          View and manage all uploaded media files
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Uploaded Media</CardTitle>
          <CardDescription>
            All images and files uploaded through the CMS
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense
            key={page}
            fallback={
              <div className="space-y-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            }
          >
            <MediaListTable page={page} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
