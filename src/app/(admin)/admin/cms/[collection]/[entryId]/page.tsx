import { Metadata } from "next";
import { requireAdmin } from "@/utils/auth";
import { redirect } from "next/navigation";
import { cmsConfig, type CollectionsUnion } from "@/../cms.config";
import { getCmsEntryById } from "@/lib/cms/cms-repository";
import {
  getCmsNavigationNodeByEntryId,
  getCmsNavigationTree,
} from "@/lib/cms/cms-navigation-repository";
import { CMS_STATUS_FILTER_ALL } from "@/types/cms";
import { CmsEntryForm } from "../_components/cms-entry-form";
import { Route } from "next";
import { getCmsCollectionNavigationKey } from "@/lib/cms/cms-navigation-config";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ collection: string; entryId: string }>;
}): Promise<Metadata> {
  const { collection, entryId } = await params;
  const collectionConfig = cmsConfig.collections[collection as CollectionsUnion];

  if (!collectionConfig) {
    return {
      title: "Edit Entry | Admin",
    };
  }

  const entry = await getCmsEntryById({
    id: entryId,
    includeRelations: {
      tags: false,
    }
  });

  return {
    title: `Edit ${collectionConfig.labels.singular} | Admin`,
    description: entry?.title || `Edit ${collectionConfig.labels.singular.toLowerCase()}`,
  };
}

export default async function EditEntryPage({
  params,
}: {
  params: Promise<{ collection: string; entryId: string }>;
}) {
  const session = await requireAdmin({ doNotThrowError: true });

  if (!session) {
    return redirect("/");
  }

  const { collection, entryId } = await params;

  const collectionConfig = cmsConfig.collections[collection as CollectionsUnion];

  if (!collectionConfig) {
    return redirect("/admin/cms");
  }

  const entry = await getCmsEntryById({
    id: entryId,
    includeRelations: {
      tags: true,
    }
  });
  if (!entry) {
    return redirect(`/admin/cms/${collection}`);
  }

  const navigationKey = getCmsCollectionNavigationKey(collection as CollectionsUnion);
  const entryPublicUrl = navigationKey
    ? (
        getCmsNavigationNodeByEntryId({
          entryId: entry.id,
          nodes: await getCmsNavigationTree({
            navigationKey,
            status: CMS_STATUS_FILTER_ALL,
          }),
        })?.resolvedPath as Route | null
      )
    : null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <CmsEntryForm
        collection={collection}
        navigationPublicUrl={entryPublicUrl}
        mode="edit"
        entry={entry}
        pageTitle={`Edit ${collectionConfig.labels.singular}`}
        pageSubtitle={entry.title}
      />
    </div>
  );
}
