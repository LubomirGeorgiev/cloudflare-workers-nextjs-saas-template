import { Metadata } from "next";
import { requireAdmin } from "@/utils/auth";
import { redirect } from "next/navigation";
import { getCmsTagById, getCmsEntriesByTagId } from "@/lib/cms/cms-repository";
import { TagForm } from "../_components/tag-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { cmsConfig, type CollectionsUnion } from "@/../cms.config";
import { CmsEntryStatusBadge } from "../../_components/cms-entry-status-badge";

export const metadata: Metadata = {
  title: "Edit Tag | Admin",
  description: "Update tag details and view entries using this tag",
};

export default async function EditTagPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireAdmin({ doNotThrowError: true });

  if (!session) {
    return redirect("/");
  }

  const { id } = await params;
  const tag = await getCmsTagById(id);

  if (!tag) {
    return redirect("/admin/cms/tags");
  }

  const entriesByCollection = await getCmsEntriesByTagId({ tagId: id, status: "all" as const });
  const totalEntries = Object.values(entriesByCollection).reduce(
    (sum, entries) => sum + entries.length,
    0
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/admin/cms/tags">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Edit Tag</h1>
          <p className="text-muted-foreground mt-2">
            Update tag details and view entries using this tag
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <TagForm mode="edit" tag={tag} />

        <Card>
          <CardHeader>
            <CardTitle>Tag Usage</CardTitle>
            <CardDescription>
              This tag is used in {totalEntries} {totalEntries === 1 ? "entry" : "entries"} across{" "}
              {Object.keys(entriesByCollection).length} {Object.keys(entriesByCollection).length === 1 ? "collection" : "collections"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {Object.keys(entriesByCollection).length === 0 ? (
              <p className="text-sm text-muted-foreground">No entries using this tag yet.</p>
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
    </div>
  );
}
