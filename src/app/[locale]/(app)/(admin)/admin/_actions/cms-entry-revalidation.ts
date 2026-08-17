import "server-only";

import { revalidatePath } from "next/cache";

import { type CollectionsUnion } from "@/../cms.config";
import { ENABLED_LOCALES } from "@/i18n/config";
import { cmsEntryPagePath, purgeCmsEntryMarkdownPages } from "@/lib/cms/cms-entry-page-purge";
import { localizedPagePathname } from "@/lib/markdown-pages/page-paths";

export async function revalidateCmsEntryPaths({
  collection,
  entryId,
  slugs,
  includeCreatePath = false,
}: {
  collection: CollectionsUnion;
  entryId: string;
  slugs: string[];
  includeCreatePath?: boolean;
}): Promise<void> {
  revalidatePath("/admin/cms");
  revalidatePath(`/admin/cms/${collection}`);
  revalidatePath(`/admin/cms/${collection}/${entryId}`);

  if (includeCreatePath) {
    revalidatePath(`/admin/cms/${collection}/new`);
  }

  const entries = Array.from(new Set(slugs.filter(Boolean))).map((slug) => ({ collection, slug }));

  for (const entry of entries) {
    const pathname = cmsEntryPagePath(entry);

    if (!pathname) {
      continue;
    }

    for (const locale of ENABLED_LOCALES) {
      revalidatePath(localizedPagePathname({ locale, pathname }));
    }
  }

  await purgeCmsEntryMarkdownPages({ entries });
}
