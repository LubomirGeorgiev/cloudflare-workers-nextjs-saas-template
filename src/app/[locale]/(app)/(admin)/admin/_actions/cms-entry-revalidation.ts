import "server-only";

import { revalidatePath } from "next/cache";

import { type CollectionsUnion } from "@/../cms.config";
import { ENABLED_LOCALES } from "@/i18n/config";
import { cmsEntryPagePath } from "@/lib/cms/cms-entry-page-purge";
import { localizedPagePathname } from "@/lib/markdown-pages/page-paths";

// The App Router half only. The `.md` twins go in `invalidateCmsEntries`, before its warm: a purge
// here, after the write returned, would delete the twins that warm just stored.
export function revalidateCmsEntryPaths({
  collection,
  entryId,
  slugs,
  previousSlug,
  includeCreatePath = false,
}: {
  collection: CollectionsUnion;
  entryId: string;
  slugs: string[];
  // The slug before a rename. A caller that could not read the previous row passes `undefined`.
  previousSlug?: string;
  includeCreatePath?: boolean;
}): void {
  revalidatePath("/admin/cms");
  revalidatePath(`/admin/cms/${collection}`);
  revalidatePath(`/admin/cms/${collection}/${entryId}`);

  if (includeCreatePath) {
    revalidatePath(`/admin/cms/${collection}/new`);
  }

  const allSlugs = previousSlug ? [previousSlug, ...slugs] : slugs;
  const entries = Array.from(new Set(allSlugs.filter(Boolean))).map((slug) => ({ collection, slug }));

  for (const entry of entries) {
    const pathname = cmsEntryPagePath(entry);

    if (!pathname) {
      continue;
    }

    for (const locale of ENABLED_LOCALES) {
      revalidatePath(localizedPagePathname({ locale, pathname }));
    }
  }
}
