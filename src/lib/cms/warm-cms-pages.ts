import "server-only";

import { DEFAULT_LOCALE, ENABLED_LOCALES, isLocale, type Locale } from "@/i18n/config";
import type { CmsEntryRef } from "@/lib/cms/cms-cache-invalidation";
import { cmsEntryListingPath, cmsEntryPagePath } from "@/lib/cms/cms-entry-page-purge";
import { getEntryLocales } from "@/lib/cms/entry/queries";
import { buildAbsoluteMarkdownPageUrl, localizedPagePathname } from "@/lib/markdown-pages/page-paths";
import { absoluteLocalizedUrl } from "@/utils/i18n-urls";
import { isLocalhost } from "@/utils/is-local";
import { isTestMode } from "@/utils/is-test-mode";
import { mapInBatches } from "@/utils/map-in-batches";
import { runInBackground } from "@/utils/run-in-background";

/** Names the warmer in the origin logs, so a fork can filter or block these hits. */
export const CMS_WARM_USER_AGENT = "cms-cache-warmer";

/** Upper bound on the GETs one invalidation may spend. A Worker invocation has a subrequest budget. */
export const MAX_WARM_URLS_PER_CALL = 12;

/**
 * Isolate-wide ceiling. One admin action can invalidate many entries (`updateCmsMediaAction` does),
 * and each call adds its own URLs, so the per-call bound alone does not bound the fan-out.
 */
const MAX_IN_FLIGHT_WARM_URLS = 24;

const WARM_FETCH_BATCH_SIZE = 4;

// Collapses the listing-page URL that every entry of one collection shares.
const inFlightWarmUrls = new Set<string>();

/** Localhost is unreachable from the Worker: `global_fetch_strictly_public` blocks the loopback. */
function isWarmingDisabled(): boolean {
  return isLocalhost || isTestMode();
}

// A publish outside a request scope (queue consumer) cannot read the cached locale list, and a
// warm must never fail the publish, so the canonical locale is the fallback.
async function resolveWarmLocales(entry: CmsEntryRef): Promise<Locale[]> {
  try {
    const locales = await getEntryLocales({
      collectionSlug: entry.collection,
      slug: entry.slug,
    });

    const served = locales.filter(
      (locale): locale is Locale => isLocale(locale) && ENABLED_LOCALES.includes(locale),
    );

    return served.length > 0 ? served : [DEFAULT_LOCALE];
  } catch {
    return [DEFAULT_LOCALE];
  }
}

/**
 * The URLs of one entry, in warm order: the entry page first, then the listing that shows it, then
 * the `.md` twin of each. The twin is one extra GET on a URL we already resolved, and the publish
 * just deleted its KV copy, so an agent would otherwise pay the same render a visitor pays.
 */
function buildEntryWarmUrls({
  entry,
  locales,
}: {
  entry: CmsEntryRef;
  locales: Locale[];
}): string[] {
  const pagePath = cmsEntryPagePath(entry);

  if (!pagePath) {
    return [];
  }

  const pathnames = [pagePath, cmsEntryListingPath(pagePath)];
  const urls: string[] = [];

  for (const locale of locales) {
    for (const pathname of pathnames) {
      urls.push(absoluteLocalizedUrl({ pathname, locale }));
    }
  }

  for (const locale of locales) {
    for (const pathname of pathnames) {
      urls.push(buildAbsoluteMarkdownPageUrl({ pathname: localizedPagePathname({ locale, pathname }) }));
    }
  }

  return urls;
}

async function warmUrl(url: string): Promise<void> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "user-agent": CMS_WARM_USER_AGENT },
      redirect: "manual",
    });

    await response.body?.cancel();
  } catch {
    // Best effort: the first visitor pays the miss, exactly as before.
  } finally {
    inFlightWarmUrls.delete(url);
  }
}

// Both caps bound the whole call, so the entry loop stops with the URL loop rather than moving on
// to an entry it could not add a single URL for.
function hasReachedWarmCap(urls: string[]): boolean {
  return urls.length >= MAX_WARM_URLS_PER_CALL || inFlightWarmUrls.size >= MAX_IN_FLIGHT_WARM_URLS;
}

async function warmUrls(entries: CmsEntryRef[]): Promise<void> {
  const urls: string[] = [];

  for (const entry of entries) {
    if (hasReachedWarmCap(urls)) {
      break;
    }

    // Read per entry, after the cap check: a prefetch of every entry would spend D1 reads on the
    // entries the cap then drops, and the one caller passes a single entry anyway.
    const locales = await resolveWarmLocales(entry);

    for (const url of buildEntryWarmUrls({ entry, locales })) {
      if (hasReachedWarmCap(urls)) {
        break;
      }

      if (inFlightWarmUrls.has(url)) {
        continue;
      }

      inFlightWarmUrls.add(url);
      urls.push(url);
    }
  }

  await mapInBatches({
    items: urls,
    batchSize: WARM_FETCH_BATCH_SIZE,
    fn: (url) => warmUrl(url),
  });
}

/**
 * Re-renders the pages a publish just invalidated, so the first visitor reads a warm KV entry
 * instead of paying the D1 reads and the TipTap render. Fire and forget: it returns at once and the
 * fetches run through `waitUntil`, so it never blocks or fails the publish.
 */
export function warmCmsEntryPages({ entries }: { entries: CmsEntryRef[] }): void {
  if (isWarmingDisabled() || entries.length === 0) {
    return;
  }

  runInBackground(warmUrls(entries));
}
