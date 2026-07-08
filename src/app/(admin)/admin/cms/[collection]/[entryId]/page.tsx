import { Metadata } from "next";
import { cache } from "react";
import { requireAdmin } from "@/utils/auth";
import { redirect } from "next/navigation";
import { cmsConfig, type CollectionsUnion } from "@/../cms.config";
import { getCmsEntryById, getEntryLocaleSiblings } from "@/lib/cms/entry";
import {
  getCmsNavigationNodeByEntrySlug,
  getCmsNavigationTree,
} from "@/lib/cms/cms-navigation-repository";
import { CMS_STATUS_FILTER_ALL } from "@/types/cms";
import { CmsEntryForm } from "../_components/cms-entry-form";
import { CmsEntryLocaleSwitcher } from "../_components/cms-entry-locale-switcher";
import { CmsTranslationStaleBanner } from "../_components/cms-translation-stale-banner";
import { Route } from "next";
import { getCmsCollectionNavigationKey } from "@/lib/cms/cms-navigation-config";
import { getPathname } from "@/i18n/navigation";
import { type Locale } from "@/i18n/config";

// Request-scoped dedup only (React cache); the underlying by-id read always
// hits fresh DB state — admin edit must not serve a stale remote-cached copy.
const getFreshCmsEntryById = cache(async (entryId: string) => {
  return getCmsEntryById({
    id: entryId,
    includeRelations: {
      tags: true,
    },
  });
});

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

  const entry = await getFreshCmsEntryById(entryId);

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

  const entry = await getFreshCmsEntryById(entryId);
  if (!entry) {
    return redirect(`/admin/cms/${collection}`);
  }

  const localeSiblings = await getEntryLocaleSiblings({
    collectionSlug: collection,
    slug: entry.slug,
  });

  // Staleness of the row being edited: a non-default translation whose source has
  // drifted since it was translated. The banner surfaces the re-translate controls.
  const currentSibling = localeSiblings.find(
    (sibling) => sibling.locale === entry.locale
  );

  const navigationKey = getCmsCollectionNavigationKey(collection as CollectionsUnion);
  // Resolve nav membership by the translation-group slug, not the row id: a locale
  // sibling shares its anchor's slug but has its own id, so an id lookup would report
  // every translation as "not in navigation". The resolved path is locale-agnostic,
  // so prefix it for the entry's locale to link the correct localized public URL.
  const navigationNode = navigationKey
    ? getCmsNavigationNodeByEntrySlug({
        slug: entry.slug,
        nodes: await getCmsNavigationTree({
          navigationKey,
          status: CMS_STATUS_FILTER_ALL,
        }),
      })
    : null;
  const entryPublicUrl = navigationNode?.resolvedPath
    ? (getPathname({
        href: navigationNode.resolvedPath,
        locale: entry.locale as Locale,
      }) as Route)
    : null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <CmsEntryLocaleSwitcher
        collection={collection as CollectionsUnion}
        slug={entry.slug}
        currentLocale={entry.locale as Locale}
        siblings={localeSiblings}
      />
      {currentSibling?.isStale && (
        <CmsTranslationStaleBanner
          entryId={entry.id}
          staleFields={currentSibling.staleFields}
        />
      )}
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
