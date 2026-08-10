import { Metadata } from "next";
import { requireAdminOrRedirectHome } from "@/utils/auth-redirect";

import { Link, redirect } from "@/i18n/navigation";
import { type Locale } from "@/i18n/config";
import { cmsConfig } from "@/../cms.config";
import { CmsEntriesTable } from "./_components/cms-entries-table";
import { buttonVariants } from "@/components/ui/button";
import { Plus, ArrowLeft, PanelLeft } from "lucide-react";
import { type CollectionsUnion } from "@/../cms.config";
import { getCmsNavigationTree } from "@/lib/cms/cms-navigation-repository";
import { CMS_STATUS_FILTER_ALL } from "@/types/cms";
import { getCmsCollectionNavigationKey } from "@/lib/cms/cms-navigation-config";

// Collect the slugs of nav-attached entries, not their ids: nav membership belongs to
// the (collection, slug) translation group, so the table can flag every locale sibling
// of an attached anchor as in-navigation regardless of its own row id.
function collectNavigationEntrySlugs(
  nodes: Awaited<ReturnType<typeof getCmsNavigationTree>>
): string[] {
  return nodes.flatMap((node) => {
    const childSlugs = collectNavigationEntrySlugs(node.children);

    return node.entry?.slug ? [node.entry.slug, ...childSlugs] : childSlugs;
  });
}

interface CollectionPageProps {
  params: Promise<{ collection: CollectionsUnion; locale: Locale }>;
}

export async function generateMetadata({
  params,
}: CollectionPageProps): Promise<Metadata> {
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

export default async function CollectionPage({ params }: CollectionPageProps) {
  await requireAdminOrRedirectHome();

  const { collection, locale } = await params;

  const collectionConfig = cmsConfig.collections[collection];
  if (!collectionConfig) {
    return redirect({ href: "/admin/cms", locale });
  }

  const navigationKey = getCmsCollectionNavigationKey(collection);
  const navigationEntrySlugs = navigationKey
    ? collectNavigationEntrySlugs(
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
          <Link
            href="/admin/cms"
            className={buttonVariants({ variant: "ghost", size: "icon" })}
          >
              <ArrowLeft className="h-4 w-4" />
          </Link>
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
            <Link
              href={`/admin/cms/navigation/${navigationKey}`}
              className={buttonVariants({ variant: "outline" })}
            >
                <PanelLeft className="h-4 w-4 mr-2" />
                Navigation
            </Link>
          ) : null}
          <Link
            href={`/admin/cms/${collection}/new`}
            className={buttonVariants()}
          >
              <Plus className="h-4 w-4 mr-2" />
              Create {collectionConfig.labels.singular}
          </Link>
        </div>
      </div>

      <CmsEntriesTable
        collection={collection}
        navigationEntrySlugs={navigationEntrySlugs}
      />
    </div>
  );
}
