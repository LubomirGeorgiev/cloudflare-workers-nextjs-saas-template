import { requireAdmin } from "@/utils/auth";
import { redirect } from "next/navigation";
import { cmsConfig } from "@/../cms.config";
import { getCmsEntryById } from "@/lib/cms/cms-repository";
import { CmsEntryForm } from "../_components/cms-entry-form";

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

  const collectionConfig = cmsConfig.collections[collection as keyof typeof cmsConfig.collections];

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

  return (
    <div className="flex flex-col gap-6 p-6">
      <CmsEntryForm
        collection={collection}
        mode="edit"
        entry={entry}
        pageTitle={`Edit ${collectionConfig.labels.singular}`}
        pageSubtitle={entry.title}
        collectionConfig={collectionConfig}
      />
    </div>
  );
}
