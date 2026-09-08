import "server-only";

import type { CmsNavigationKey } from "@/../cms.config";
import type { CmsEntryRef } from "@/lib/cms/cms-cache-invalidation";
import { getCmsCollectionNavigationKey } from "@/lib/cms/cms-navigation-config";

/**
 * The public paths of entries whose URL lives in a navigation tree rather than in a `previewUrl`.
 *
 * The docs collection is the case: `cmsEntryPagePath` returns `null` for it, so the purge would
 * otherwise never name the entry's own page. Read straight from D1 rather than through
 * `getCmsNavigationTree`, because the cached tree is filtered by publish status: an unpublish would
 * resolve no path exactly when the purge matters most. Never throws.
 *
 * `@/db` is imported lazily so the purge module, which the warmer and the revalidation action also
 * import, keeps drizzle and the `cloudflare:workers` binding off its own top level.
 */
export async function getCmsNavigationEntryPaths({
  entries,
}: {
  entries: CmsEntryRef[];
}): Promise<string[]> {
  const slugsByNavigationKey = new Map<CmsNavigationKey, Set<string>>();

  for (const entry of entries) {
    const navigationKey = getCmsCollectionNavigationKey(entry.collection);

    if (!navigationKey) {
      continue;
    }

    const slugs = slugsByNavigationKey.get(navigationKey) ?? new Set<string>();
    slugs.add(entry.slug);
    slugsByNavigationKey.set(navigationKey, slugs);
  }

  if (slugsByNavigationKey.size === 0) {
    return [];
  }

  try {
    const db = (await import("@/db")).getDB();
    const paths = new Set<string>();

    for (const [navigationKey, slugs] of slugsByNavigationKey) {
      // Every locale row of the slug, not just the anchor: navigation links the default-locale row,
      // and the mutation that triggered this purge may have edited a translation.
      const entryRows = await db.query.cmsEntryTable.findMany({
        where: { slug: { in: Array.from(slugs) } },
        columns: { id: true },
      });

      if (entryRows.length === 0) {
        continue;
      }

      const items = await db.query.cmsNavigationItemTable.findMany({
        where: {
          navigationKey,
          entryId: { in: entryRows.map((row) => row.id) },
        },
        columns: { resolvedPath: true },
      });

      for (const item of items) {
        if (item.resolvedPath) {
          paths.add(item.resolvedPath);
        }
      }
    }

    return Array.from(paths);
  } catch {
    // Best effort, like every other purge on this path: a failed lookup falls back to the TTL.
    return [];
  }
}
