import "server-only";

import { INDEXED_DOCS_ROUTES } from "@/constants/docs-routes";
import { DOCS_BASE_PATH } from "@/lib/cms/docs-config";
import { purgeEdgeHtmlPages } from "@/lib/edge/edge-html-cache";
import { purgeMarkdownPageCache } from "@/lib/markdown-pages/purge-page-cache";

// The docs pages that are app routes, so `resolveMdRequestTarget` serves their `.md` from the page
// branch and caches it under `md-page:`. Same list that builds that allowlist, so the machine routes
// of `DOCS_ROUTES` stay out: they are not localized pages, so they never reach that cache.
const DOCS_ROUTE_PAGE_PATHNAMES = INDEXED_DOCS_ROUTES.map(({ pathname }) => pathname);

// The docs root bakes the same sidebar and is the most-read page of the section, so the stored HTML
// purge names it too. A CMS docs entry publishes no page path of its own, so its stored copy waits
// out `EDGE_HTML_CACHE_TTL_SECONDS`. Shared with the admin edge-HTML purge, which names the same
// docs pages without reading the navigation tree.
export const DOCS_EDGE_HTML_PATHNAMES = [DOCS_BASE_PATH, ...DOCS_ROUTE_PAGE_PATHNAMES];

// Shared only while pending: one admin mutation can invalidate the navigation once per affected
// entry (`updateCmsMediaAction` does), and each call would otherwise repeat the same KV sweep.
let pendingPurge: Promise<void> | null = null;

async function runPurge(): Promise<void> {
  try {
    await Promise.all([
      purgeMarkdownPageCache({ pathnames: DOCS_ROUTE_PAGE_PATHNAMES }),
      purgeEdgeHtmlPages({ pathnames: DOCS_EDGE_HTML_PATHNAMES }),
    ]);
  } finally {
    pendingPurge = null;
  }
}

// The one purge hook for a docs navigation change. Each docs app-route page bakes the CMS sidebar
// into its converted `.md`, and `revalidatePath` reaches only the App Router copy. Usable from the
// queue consumer too, which has no App Router request scope. Never throws.
export async function purgeDocsNavigationMarkdownPages(): Promise<void> {
  pendingPurge ??= runPurge();

  await pendingPurge;
}
