import { requireAdmin } from "@/utils/auth";
import { redirect } from "next/navigation";
import { cmsConfig } from "@/../cms.config";
import { CmsEntriesTable } from "./_components/cms-entries-table";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Plus, ArrowLeft } from "lucide-react";
import { type CollectionsUnion } from "@/../cms.config";

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ collection: CollectionsUnion }>;
}) {
  const session = await requireAdmin({ doNotThrowError: true });

  if (!session) {
    return redirect("/");
  }

  const { collection } = await params;

  const collectionConfig = cmsConfig.collections[collection];
  if (!collectionConfig) {
    return redirect("/admin/cms");
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/admin/cms">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {collectionConfig.labels.plural}
            </h1>
            <p className="text-muted-foreground mt-2">
              Manage your {collectionConfig.labels.plural.toLowerCase()}
            </p>
          </div>
        </div>
        <Button asChild>
          <Link href={`/admin/cms/${collection}/new`}>
            <Plus className="h-4 w-4 mr-2" />
            Create {collectionConfig.labels.singular}
          </Link>
        </Button>
      </div>

      <CmsEntriesTable collection={collection} />
    </div>
  );
}
