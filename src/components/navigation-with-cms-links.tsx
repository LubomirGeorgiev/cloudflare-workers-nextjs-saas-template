import "server-only";

import Link from "next/link";
import { ComponentIcon, Menu } from "lucide-react";

import { Navigation } from "@/components/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { SITE_NAME } from "@/constants";
import { getCmsNavigationRootPath } from "@/lib/cms/cms-navigation-repository";
import { DOCS_SLUG } from "@/lib/cms/docs-config";
import { getCmsCollectionCount } from "@/lib/cms/entry";

export async function NavigationWithCmsLinks() {
  const [blogPostCount, docsRootPath] = await Promise.all([
    getCmsCollectionCount({
      collectionSlug: "blog",
      status: "published",
    }),
    getCmsNavigationRootPath({
      navigationKey: DOCS_SLUG,
    }),
  ]);

  return (
    <Navigation
      hasBlogPosts={blogPostCount > 0}
      hasDocsPages={Boolean(docsRootPath)}
    />
  );
}

export function NavigationWithCmsLinksFallback() {
  return (
    <nav className="dark:bg-muted/30 bg-muted/60 shadow dark:shadow-xl z-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center">
            <Link
              href="/"
              prefetch={false}
              className="text-xl md:text-2xl font-bold text-primary flex items-center gap-2 md:gap-3"
            >
              <ComponentIcon className="w-6 h-6 md:w-7 md:h-7" />
              {SITE_NAME}
            </Link>
          </div>

          <div className="hidden md:flex md:items-center md:space-x-6">
            <div className="flex items-baseline space-x-4">
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-8 w-16" />
            </div>
            <Skeleton className="h-10 w-[80px] bg-primary" />
          </div>

          <div className="md:hidden flex items-center">
            <div className="inline-flex size-12 items-center justify-center rounded-md">
              <Menu className="w-9 h-9" />
              <span className="sr-only">Loading menu</span>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
