import "server-only";

import { hasPublishedBlogPosts } from "@/lib/blog-visibility";
import { CMS_DATA_CACHE_TTL } from "@/constants/data-cache";
import {
  SITE_HEADER_CACHE_TAGS,
  SITE_HEADER_NAVIGATION_KEY,
} from "@/lib/cms/cms-invalidation-scopes";
import { getCmsNavigationRootPath } from "@/lib/cms/cms-navigation-repository";
import { createNavigationMemo } from "@/lib/cms/navigation-memos";
import { setCacheScope } from "@/utils/cache";

// The read takes no argument, so the whole memo is one entry.
const PUBLIC_NAVIGATION_LINKS_MEMO_ENTRIES = 1;

// The header renders one link per bit. It needs no path, so the cached entry holds none.
interface PublicNavigationLinks {
  hasBlogPosts: boolean;
  hasDocsPages: boolean;
}

// The header asks both questions on every public page and never one without the other, so they
// share one cache entry: one KV read and one tag set per request instead of two, and a hit skips
// the whole navigation tree blob that `getCmsNavigationRootPath` reads one path out of.
async function loadPublicNavigationLinks(): Promise<PublicNavigationLinks> {
  "use cache: remote";
  setCacheScope({
    // The union of the two tags the merged reads carry. The site-header invalidation scope drops
    // the same list, so the read and the purge cannot drift.
    tags: [...SITE_HEADER_CACHE_TAGS],
    ttl: CMS_DATA_CACHE_TTL,
  });

  const [hasBlogPosts, docsRootPath] = await Promise.all([
    hasPublishedBlogPosts(),
    getCmsNavigationRootPath({ navigationKey: SITE_HEADER_NAVIGATION_KEY }),
  ]);

  return { hasBlogPosts, hasDocsPages: docsRootPath !== null };
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
