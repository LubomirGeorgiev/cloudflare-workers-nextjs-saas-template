import { type Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { cmsConfig, type CmsNavigationKey } from "@/../cms.config";
import { CMS_STATUS_FILTER_ALL } from "@/types/cms";
import { getCmsNavigationTree } from "@/lib/cms/cms-navigation-repository";
import { getCmsCollection, getEntryLocalesForSlugs } from "@/lib/cms/entry";
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
  const collectionSlug = getCmsNavigationConfig(navigationKey).collectionSlug;
  const [initialTree, entries] = await Promise.all([
    getCmsNavigationTree({
      navigationKey,
      status: CMS_STATUS_FILTER_ALL,
    }),
    getCmsCollection({
      collectionSlug,
      status: CMS_STATUS_FILTER_ALL,
    }),
  ]);

  // Which locales each linked entry is translated into, so PAGE rows can flag
  // their translation coverage (they render the entry's localized title) without
  // the admin opening each one. Keyed by entryId to match nav nodes' `entryId`.
  const entryLocaleCoverage = await getEntryLocalesForSlugs({
    collectionSlug,
    slugs: entries.map((entry) => entry.slug),
  });
  const entryLocalesByEntryId = Object.fromEntries(
    entries.map((entry) => [entry.id, Array.from(entryLocaleCoverage.get(entry.slug) ?? [])])
  );

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
        entryLocalesByEntryId={entryLocalesByEntryId}
        navigationKey={navigationKey}
        navigationLabel={navigation.label}
        basePath={navigation.basePath}
        collectionLabelSingular={collectionConfig.labels.singular}
      />
    </div>
  );
}
