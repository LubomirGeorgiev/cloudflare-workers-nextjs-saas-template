import "server-only";

import { DEFAULT_LOCALE, ENABLED_LOCALES, isKnownLocale, type Locale } from "@/i18n/config";
import type { CmsEntryRef } from "@/lib/cms/cms-cache-invalidation";
import { cmsEntryListingPath, cmsEntryPagePath } from "@/lib/cms/cms-entry-page-purge";
import { getEntryLocales } from "@/lib/cms/entry/queries";
import { buildAbsoluteMarkdownPageUrl, localizedPagePathname } from "@/lib/markdown-pages/page-paths";
import { absoluteLocalizedUrl } from "@/utils/i18n-urls";
import { isLocalhost } from "@/utils/is-local";
import { isTestMode } from "@/utils/is-test-mode";
import { mapInBatches } from "@/utils/map-in-batches";
import { runInBackground } from "@/utils/run-in-background";
import { withSpan } from "@/utils/trace";

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

const WARM_SPAN_NAME = "app.cms.warm";
const URL_COUNT_ATTRIBUTE = "app.cms.url_count";
const CAPPED_ATTRIBUTE = "app.cms.capped";
const WARM_OK_COUNT_ATTRIBUTE = "app.cms.warm_ok_count";
const WARM_FAILED_COUNT_ATTRIBUTE = "app.cms.warm_failed_count";

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
      (locale): locale is Locale => isKnownLocale(locale) && ENABLED_LOCALES.includes(locale),
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

// Never rejects: a fetch that throws counts as a failed warm.
async function warmUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "user-agent": CMS_WARM_USER_AGENT },
      redirect: "manual",
    });

    await response.body?.cancel();

    return response.ok;
  } catch {
    // Best effort: the first visitor pays the miss, exactly as before.
    return false;
  } finally {
    inFlightWarmUrls.delete(url);
  }
}

// Both caps bound the whole call, so the entry loop stops with the URL loop rather than moving on
// to an entry it could not add a single URL for.
function hasReachedWarmCap(urls: string[]): boolean {
  return urls.length >= MAX_WARM_URLS_PER_CALL || inFlightWarmUrls.size >= MAX_IN_FLIGHT_WARM_URLS;
}

async function warmUrls({ entries, span }: { entries: CmsEntryRef[]; span: Span }): Promise<void> {
  const urls: string[] = [];
  let capped = false;

  for (const entry of entries) {
    if (hasReachedWarmCap(urls)) {
      capped = true;
      break;
    }

    // Read per entry, after the cap check: a prefetch of every entry would spend D1 reads on the
    // entries the cap then drops, and the one caller passes a single entry anyway.
    const locales = await resolveWarmLocales(entry);

    for (const url of buildEntryWarmUrls({ entry, locales })) {
      if (hasReachedWarmCap(urls)) {
        capped = true;
        break;
      }

      if (inFlightWarmUrls.has(url)) {
        continue;
      }

      inFlightWarmUrls.add(url);
      urls.push(url);
    }
  }

  span.setAttributes({ [URL_COUNT_ATTRIBUTE]: urls.length, [CAPPED_ATTRIBUTE]: capped });

  const results = await mapInBatches({
    items: urls,
    batchSize: WARM_FETCH_BATCH_SIZE,
    fn: (url) => warmUrl(url),
  });

  if (span.isTraced) {
    const okCount = results.filter(Boolean).length;

    span.setAttributes({
      [WARM_OK_COUNT_ATTRIBUTE]: okCount,
      [WARM_FAILED_COUNT_ATTRIBUTE]: results.length - okCount,
    });
  }
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

  runInBackground(withSpan({ name: WARM_SPAN_NAME, run: (span) => warmUrls({ entries, span }) }));
}
