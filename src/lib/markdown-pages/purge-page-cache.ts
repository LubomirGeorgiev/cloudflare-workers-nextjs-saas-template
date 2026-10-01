import "server-only";

import { env as workerEnv } from "cloudflare:workers";

import { ENABLED_LOCALES } from "@/i18n/config";
import { mapInBatches } from "@/utils/map-in-batches";
import { withSpan } from "@/utils/trace";

import { buildMarkdownPageCacheKey } from "./page-cache";
import { localizedPagePathname } from "./page-paths";

// KV has no bulk list or delete, so a sweep is one request per prefix and per key. Keep each wave
// small: the number of cached tag and author pages is unbounded.
const PAGE_CACHE_KV_BATCH_SIZE = 10;

const MARKDOWN_PURGE_SPAN_NAME = "app.cms.markdown_purge";
const KEYS_DELETED_ATTRIBUTE = "app.cms.keys_deleted";
const KEYS_FAILED_ATTRIBUTE = "app.cms.keys_failed";

async function listPageCacheKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];

  // The caller has already committed its write, so a failed listing yields what it has instead of
  // throwing; the cache TTL stays the backstop for the rest.
  try {
    let cursor: string | undefined;

    do {
      const page = await workerEnv.KV_STORE.list({ prefix, cursor });

      keys.push(...page.keys.map(({ name }) => name));
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  } catch (error) {
    console.error("listPageCacheKeys: KV list failed", error);
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
  } catch (error) {
    console.error("pageCacheKeyPrefixes: building cache keys failed", error);
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
  await withSpan({
    name: MARKDOWN_PURGE_SPAN_NAME,
    run: async (span) => {
      const keyLists = await mapInBatches({
        items: pageCacheKeyPrefixes(pathnames),
        batchSize: PAGE_CACHE_KV_BATCH_SIZE,
        fn: (prefix) => listPageCacheKeys(prefix),
      });

      const deleted = await mapInBatches({
        items: Array.from(new Set(keyLists.flat())),
        batchSize: PAGE_CACHE_KV_BATCH_SIZE,
        // Own rejection handler per key: this runs after the publish committed, so one failed delete must not
        // fail the action or stop the other keys.
        fn: (key) => workerEnv.KV_STORE.delete(key).then(() => true, () => false),
      });

      if (span.isTraced) {
        const deletedCount = deleted.filter(Boolean).length;

        span.setAttributes({
          [KEYS_DELETED_ATTRIBUTE]: deletedCount,
          [KEYS_FAILED_ATTRIBUTE]: deleted.length - deletedCount,
        });
      }
    },
  });
}
