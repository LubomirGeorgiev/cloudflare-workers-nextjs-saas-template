import "server-only";

import { env as workerEnv } from "cloudflare:workers";

import { ENABLED_LOCALES } from "@/i18n/config";
import { mapInBatches } from "@/utils/map-in-batches";

import { buildMarkdownPageCacheKey } from "./page-cache";
import { localizedPagePathname } from "./page-paths";

// KV has no bulk list or delete, so a sweep is one request per prefix and per key. Keep each wave
// small: the number of cached tag and author pages is unbounded.
const PAGE_CACHE_KV_BATCH_SIZE = 10;

async function listPageCacheKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];

  // The caller has already committed its write, so a failed listing yields what it has instead of
  // throwing; the cache TTL stays the backstop for the rest.
  try {
    let cursor: string | undefined;

    do {
      const page = await workerEnv.NEXT_INC_CACHE_KV.list({ prefix, cursor });

      keys.push(...page.keys.map(({ name }) => name));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  } catch {
    return keys;
  }

  return keys;
}

function pageCacheKeyPrefixes(pathnames: string[]): string[] {
  const prefixes = new Set<string>();

  // A build with no injected id already fails every `.md` route loudly, so it must not fail the
  // publish here as well.
  try {
    for (const pathname of pathnames) {
      for (const locale of ENABLED_LOCALES) {
        prefixes.add(
          buildMarkdownPageCacheKey({ pathname: localizedPagePathname({ locale, pathname }) }),
        );
      }
    }
  } catch {
    return [];
  }

  return Array.from(prefixes);
}

// Drops every cached page Markdown body under `pathnames`, in every served locale. Each pathname is
// a prefix, so one entry covers the pages below it too. Never throws.
export async function purgeMarkdownPageCache({
  pathnames,
}: {
  pathnames: string[];
}): Promise<void> {
  const keyLists = await mapInBatches({
    items: pageCacheKeyPrefixes(pathnames),
    batchSize: PAGE_CACHE_KV_BATCH_SIZE,
    fn: (prefix) => listPageCacheKeys(prefix),
  });

  await mapInBatches({
    items: Array.from(new Set(keyLists.flat())),
    batchSize: PAGE_CACHE_KV_BATCH_SIZE,
    // Own `.catch` per key: this runs after the publish committed, so one failed delete must not
    // fail the action or stop the other keys.
    fn: (key) => workerEnv.NEXT_INC_CACHE_KV.delete(key).catch(() => undefined),
  });
}
