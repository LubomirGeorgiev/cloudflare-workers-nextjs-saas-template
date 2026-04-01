import { type Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { cmsConfig, type CmsNavigationKey } from "@/../cms.config";
import { CMS_STATUS_FILTER_ALL } from "@/types/cms";
import { getCmsNavigationTree } from "@/lib/cms/cms-navigation-repository";
import { getCmsCollection } from "@/lib/cms/cms-repository";
import { getCmsNavigationConfig } from "@/lib/cms/cms-navigation-config";
import { requireAdmin } from "@/utils/auth";
import { CmsNavigationManager } from "./_components/cms-navigation-manager";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ siteKey: CmsNavigationKey }>;
}): Promise<Metadata> {
  const { siteKey: navigationKey } = await params;
  const navigation = cmsConfig.navigations[navigationKey];

  if (!navigation) {
    return {
      title: "Navigation | Admin",
    };
  }

  return {
    title: `${navigation.label} | Admin`,
    description: navigation.description || `Manage ${navigation.label.toLowerCase()}`,
  };
}

export default async function CmsNavigationSitePage({
  params,
}: {
  params: Promise<{ siteKey: CmsNavigationKey }>;
}) {
  const session = await requireAdmin({ doNotThrowError: true });

  if (!session) {
    return redirect("/");
  }

  const { siteKey: navigationKey } = await params;
  const navigation = cmsConfig.navigations[navigationKey];

  if (!navigation) {
    notFound();
  }

  const collectionConfig = cmsConfig.collections[navigation.collectionSlug as keyof typeof cmsConfig.collections];
  const [initialTree, entries] = await Promise.all([
    getCmsNavigationTree({
      navigationKey,
      status: CMS_STATUS_FILTER_ALL,
    }),
    getCmsCollection({
      collectionSlug: getCmsNavigationConfig(navigationKey).collectionSlug,
      status: CMS_STATUS_FILTER_ALL,
    }),
  ]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{navigation.label}</h1>
        <p className="text-muted-foreground mt-2">
          {navigation.description || `Manage the ${navigation.label.toLowerCase()}`}
        </p>
      </div>

      <CmsNavigationManager
        entries={entries}
        initialTree={initialTree}
        navigationKey={navigationKey}
        navigationLabel={navigation.label}
        basePath={navigation.basePath}
        collectionLabelSingular={collectionConfig.labels.singular}
      />
    </div>
  );
}
