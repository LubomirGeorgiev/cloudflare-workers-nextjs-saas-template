import "server-only";

import { Navigation } from "@/components/navigation";
import { getCmsNavigationRootPath } from "@/lib/cms/cms-navigation-repository";
import { DOCS_SLUG } from "@/lib/cms/docs-config";
import { hasPublishedBlogPosts } from "@/lib/blog-visibility";

export async function NavigationWithCmsLinks() {
  const [hasBlogPosts, docsRootPath] = await Promise.all([
    hasPublishedBlogPosts(),
    getCmsNavigationRootPath({
      navigationKey: DOCS_SLUG,
    }),
  ]);

  return (
    <Navigation
      hasBlogPosts={hasBlogPosts}
      hasDocsPages={Boolean(docsRootPath)}
    />
  );
}
