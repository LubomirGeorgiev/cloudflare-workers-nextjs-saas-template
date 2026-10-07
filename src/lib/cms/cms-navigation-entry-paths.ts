import "server-only";

import type { CmsNavigationKey } from "@/../cms.config";
import type { CmsEntryRef } from "@/lib/cms/cms-cache-invalidation";
import { getCmsCollectionNavigationKey } from "@/lib/cms/cms-navigation-config";
import { chunk } from "@/utils/chunk";

// D1 caps bound parameters at 100 per statement; the navigation key takes one more. A media
// update passes every entry that shows the image, so the slug list is unbounded.
const LOOKUP_CHUNK_SIZE = 90;

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
    const lookup = await loadNavigationPathLookup();
    const paths = new Set<string>();

    for (const [navigationKey, slugs] of slugsByNavigationKey) {
      for (const slugChunk of chunk({ items: Array.from(slugs), size: LOOKUP_CHUNK_SIZE })) {
        for (const path of await lookup({ navigationKey, slugs: slugChunk })) {
          paths.add(path);
        }
      }
    }

    return Array.from(paths);
  } catch (error) {
    // Best effort, like every other purge on this path: a failed lookup falls back to the TTL.
    console.error("Navigation entry path lookup failed", error);
    return [];
  }
}

// Loaded once per call, never per chunk (docs/worker-hot-path-and-bundle-size.md).
async function loadNavigationPathLookup() {
  const [{ getDB }, { cmsEntryTable, cmsNavigationItemTable }, { and, eq, inArray }] =
    await Promise.all([import("@/db"), import("@/db/schema"), import("drizzle-orm")]);
  const db = getDB();

  return async function readResolvedPaths({
    navigationKey,
    slugs,
  }: {
    navigationKey: CmsNavigationKey;
    slugs: string[];
  }): Promise<string[]> {
    // Every locale row of the slug, not just the anchor: navigation links the default-locale row,
    // and the mutation that triggered this purge may have edited a translation.
    const rows = await db
      .select({ resolvedPath: cmsNavigationItemTable.resolvedPath })
      .from(cmsNavigationItemTable)
      .innerJoin(cmsEntryTable, eq(cmsEntryTable.id, cmsNavigationItemTable.entryId))
      .where(and(
        eq(cmsNavigationItemTable.navigationKey, navigationKey),
        inArray(cmsEntryTable.slug, slugs),
      ));

    return rows.flatMap((row) => (row.resolvedPath ? [row.resolvedPath] : []));
  };
}

/**
 * Every resolved path in the given navigation trees, in any publish status. Each page under a tree
 * bakes its sidebar, so the purge names all of them. Straight from D1 for the reason above, and
 * never throws.
 */
export async function getCmsNavigationPagePaths({
  navigationKeys,
}: {
  navigationKeys: CmsNavigationKey[];
}): Promise<string[]> {
  if (navigationKeys.length === 0) {
    return [];
  }

  try {
    const [{ getDB }, { cmsNavigationItemTable }, { inArray }] =
      await Promise.all([import("@/db"), import("@/db/schema"), import("drizzle-orm")]);
    const rows = await getDB()
      .select({ resolvedPath: cmsNavigationItemTable.resolvedPath })
      .from(cmsNavigationItemTable)
      .where(inArray(cmsNavigationItemTable.navigationKey, navigationKeys));

    return Array.from(new Set(rows.flatMap((row) => (row.resolvedPath ? [row.resolvedPath] : []))));
  } catch (error) {
    console.error("Navigation page path lookup failed", error);
    return [];
  }
}
