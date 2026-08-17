import "server-only";

import { INDEXED_DOCS_ROUTES } from "@/constants/docs-routes";
import { purgeMarkdownPageCache } from "@/lib/markdown-pages/purge-page-cache";

// The docs pages that are app routes, so `resolveMdRequestTarget` serves their `.md` from the page
// branch and caches it under `md-page:`. Same list that builds that allowlist, so the machine routes
// of `DOCS_ROUTES` stay out: they are not localized pages, so they never reach that cache.
const DOCS_ROUTE_PAGE_PATHNAMES = INDEXED_DOCS_ROUTES.map(({ pathname }) => pathname);

// Shared only while pending: one admin mutation can invalidate the navigation once per affected
// entry (`updateCmsMediaAction` does), and each call would otherwise repeat the same KV sweep.
let pendingPurge: Promise<void> | null = null;

async function runPurge(): Promise<void> {
  try {
    await purgeMarkdownPageCache({ pathnames: DOCS_ROUTE_PAGE_PATHNAMES });
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
