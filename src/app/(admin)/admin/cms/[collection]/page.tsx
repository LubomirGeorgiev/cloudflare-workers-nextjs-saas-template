import { Metadata } from "next";
import { requireAdmin } from "@/utils/auth";
import { redirect } from "next/navigation";
import { cmsConfig } from "@/../cms.config";
import { CmsEntriesTable } from "./_components/cms-entries-table";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Plus, ArrowLeft, PanelLeft } from "lucide-react";
import { type CollectionsUnion } from "@/../cms.config";
import { getCmsNavigationTree } from "@/lib/cms/cms-navigation-repository";
import { CMS_STATUS_FILTER_ALL } from "@/types/cms";
import { getCmsCollectionNavigationKey } from "@/lib/cms/cms-navigation-config";

function collectNavigationEntryIds(
  nodes: Awaited<ReturnType<typeof getCmsNavigationTree>>
): string[] {
  return nodes.flatMap((node) => {
    const childEntryIds = collectNavigationEntryIds(node.children);

    return node.entryId ? [node.entryId, ...childEntryIds] : childEntryIds;
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ collection: CollectionsUnion }>;
}): Promise<Metadata> {
  const { collection } = await params;
  const collectionConfig = cmsConfig.collections[collection];

  if (!collectionConfig) {
    return {
      title: "Collection | Admin",
    };
  }

  return {
    title: `${collectionConfig.labels.plural} | Admin`,
    description: `Manage your ${collectionConfig.labels.plural.toLowerCase()}`,
  };
}

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

  const navigationKey = getCmsCollectionNavigationKey(collection);
  const navigationEntryIds = navigationKey
    ? collectNavigationEntryIds(
        await getCmsNavigationTree({
          navigationKey,
          status: CMS_STATUS_FILTER_ALL,
        })
      )
    : [];

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
        <div className="flex gap-2">
          {navigationKey ? (
            <Button asChild variant="outline">
              <Link href={`/admin/cms/navigation/${navigationKey}`}>
                <PanelLeft className="h-4 w-4 mr-2" />
                Navigation
              </Link>
            </Button>
          ) : null}
          <Button asChild>
            <Link href={`/admin/cms/${collection}/new`}>
              <Plus className="h-4 w-4 mr-2" />
              Create {collectionConfig.labels.singular}
            </Link>
          </Button>
        </div>
      </div>

      <CmsEntriesTable
        collection={collection}
        navigationEntryIds={navigationEntryIds}
      />
    </div>
  );
}
