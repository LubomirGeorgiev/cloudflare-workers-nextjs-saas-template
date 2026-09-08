import "server-only";

import { hasPublishedBlogPosts } from "@/lib/blog-visibility";
import { getCmsNavigationRootPath } from "@/lib/cms/cms-navigation-repository";
import { DOCS_SLUG } from "@/lib/cms/docs-config";
import { createNavigationMemo } from "@/lib/cms/navigation-memos";
import { CACHE_TAGS, setCacheScope } from "@/utils/cache";

// The read takes no argument, so the whole memo is one entry.
const PUBLIC_NAVIGATION_LINKS_MEMO_ENTRIES = 1;

interface PublicNavigationLinks {
  hasBlogPosts: boolean;
  docsRootPath: string | null;
}

// The header asks both questions on every public page and never one without the other, so they
// share one cache entry: one KV read and one tag set per request instead of two, and a hit skips
// the whole navigation tree blob that `getCmsNavigationRootPath` reads one path out of.
async function loadPublicNavigationLinks(): Promise<PublicNavigationLinks> {
  "use cache: remote";
  setCacheScope({
    // The union of the two tags the merged reads carry, so a CMS publish still drops this entry:
    // `invalidateEntryAndCollection` revalidates both.
    tags: [CACHE_TAGS.cmsCollectionCount("blog"), CACHE_TAGS.cmsNavigation(DOCS_SLUG)],
    ttl: "8 hours",
  });

  const [hasBlogPosts, docsRootPath] = await Promise.all([
    hasPublishedBlogPosts(),
    getCmsNavigationRootPath({ navigationKey: DOCS_SLUG }),
  ]);

  return { hasBlogPosts, docsRootPath };
}

// Every public page reads this, so it is the one entry a warm isolate must not pay a KV get for.
// One header renders per request, but the layout shell and the page tree both reach it, hence the
// per-request dedupe on top of the memo; the cached body below is unchanged.
const publicNavigationLinksMemo = createNavigationMemo({
  build: loadPublicNavigationLinks,
  maxEntries: PUBLIC_NAVIGATION_LINKS_MEMO_ENTRIES,
  dedupePerRequest: true,
});

export const getPublicNavigationLinks = publicNavigationLinksMemo.read;
