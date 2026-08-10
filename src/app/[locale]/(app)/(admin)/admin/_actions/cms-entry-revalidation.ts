import "server-only";

import { revalidatePath } from "next/cache";

import { cmsConfig, type CollectionsUnion } from "@/../cms.config";
import { DEFAULT_LOCALE, ENABLED_LOCALES } from "@/i18n/config";

export function revalidateCmsEntryPaths({
  collection,
  entryId,
  slugs,
  includeCreatePath = false,
}: {
  collection: CollectionsUnion;
  entryId: string;
  slugs: string[];
  includeCreatePath?: boolean;
}) {
  revalidatePath("/admin/cms");
  revalidatePath(`/admin/cms/${collection}`);
  revalidatePath(`/admin/cms/${collection}/${entryId}`);

  if (includeCreatePath) {
    revalidatePath(`/admin/cms/${collection}/new`);
  }

  const collectionConfig = cmsConfig.collections[collection];
  const previewUrlBuilder = "previewUrl" in collectionConfig ? collectionConfig.previewUrl : undefined;

  if (!previewUrlBuilder) {
    return;
  }

  for (const slug of new Set(slugs.filter(Boolean))) {
    const path = previewUrlBuilder(slug);

    for (const locale of ENABLED_LOCALES) {
      revalidatePath(locale === DEFAULT_LOCALE ? path : `/${locale}${path}`);
    }
  }
}
