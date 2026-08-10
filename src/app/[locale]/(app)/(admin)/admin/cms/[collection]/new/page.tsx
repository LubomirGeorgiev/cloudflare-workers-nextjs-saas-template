import { Metadata } from "next";
import { requireAdminOrRedirectHome } from "@/utils/auth-redirect";

import { redirect } from "@/i18n/navigation";
import { cmsConfig } from "@/../cms.config";
import { CmsEntryForm } from "../_components/cms-entry-form";
import { type CollectionsUnion } from "@/../cms.config";
import { type Locale } from "@/i18n/config";

interface NewEntryPageProps {
  params: Promise<{ collection: string; locale: Locale }>;
}

export async function generateMetadata({
  params,
}: NewEntryPageProps): Promise<Metadata> {
  const { collection } = await params;
  const collectionConfig = cmsConfig.collections[collection as CollectionsUnion];

  if (!collectionConfig) {
    return {
      title: "Create Entry | Admin",
    };
  }

  return {
    title: `Create ${collectionConfig.labels.singular} | Admin`,
    description: `Add a new ${collectionConfig.labels.singular.toLowerCase()} to your collection`,
  };
}

export default async function NewEntryPage({ params }: NewEntryPageProps) {
  await requireAdminOrRedirectHome();

  const { collection, locale } = await params;

  const collectionConfig = cmsConfig.collections[collection as CollectionsUnion];
  if (!collectionConfig) {
    return redirect({ href: "/admin/cms", locale });
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
