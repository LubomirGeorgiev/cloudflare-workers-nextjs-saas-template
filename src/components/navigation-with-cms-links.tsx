import "server-only";

import { Navigation } from "@/components/navigation";
import { getPublicNavigationLinks } from "@/lib/cms/public-navigation-links";

export async function NavigationWithCmsLinks() {
  const { hasBlogPosts, docsRootPath } = await getPublicNavigationLinks();

  return (
    <Navigation
      hasBlogPosts={hasBlogPosts}
      hasDocsPages={Boolean(docsRootPath)}
    />
  );
}
