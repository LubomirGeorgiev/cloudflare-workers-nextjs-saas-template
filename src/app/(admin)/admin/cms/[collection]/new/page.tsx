import { requireAdmin } from "@/utils/auth";
import { redirect } from "next/navigation";
import { cmsConfig } from "@/../cms.config";
import { CmsEntryForm } from "../_components/cms-entry-form";
import { type CollectionsUnion } from "@/../cms.config";

export default async function NewEntryPage({
  params,
}: {
  params: Promise<{ collection: string }>;
}) {
  const session = await requireAdmin({ doNotThrowError: true });

  if (!session) {
    return redirect("/");
  }

  const { collection } = await params;

  const collectionConfig = cmsConfig.collections[collection as CollectionsUnion];
  if (!collectionConfig) {
    return redirect("/admin/cms");
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <CmsEntryForm
        collection={collection}
        mode="create"
        pageTitle={`Create ${collectionConfig.labels.singular}`}
        pageSubtitle={`Add a new ${collectionConfig.labels.singular.toLowerCase()} to your collection`}
      />
    </div>
  );
}
