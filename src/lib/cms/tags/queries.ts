import "server-only";

import { cache } from "react";
import { and, count, desc, eq } from "drizzle-orm";

import { getDB } from "@/db";
import {
  cmsEntryTable,
  cmsEntryTagTable,
  cmsTagTable,
} from "@/db/schema";
import {
  getCmsEntriesByTagIdParamsSchema,
  getCmsTagByIdParamsSchema,
  getCmsTagLocaleSiblingsParamsSchema,
} from "@/lib/cms/tags/schemas";
import type {
  CmsEntryTagsForDisplay,
  CmsTagLocaleSibling,
  GetCmsEntriesByTagIdParams,
  GetCmsTagsParams,
} from "@/lib/cms/tags/types";
import {
  CMS_STATUS_FILTER_ALL,
  type CmsStatusFilter,
} from "@/types/cms";
import { CACHE_TAGS, setCacheScope } from "@/utils/cache";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { v } from "@/lib/validation";

// Canonical tag rows own counts and stable junction fields; locale siblings only
// overlay display fields.
export async function getCmsTags(params?: GetCmsTagsParams) {
  "use cache: remote";
  setCacheScope({
    tags: [CACHE_TAGS.CMS_TAGS],
    ttl: "8 hours",
  });

  const locale = params?.locale ?? DEFAULT_LOCALE;
  const db = getDB();

  const tags = await db
    .select({
      id: cmsTagTable.id,
      name: cmsTagTable.name,
      slug: cmsTagTable.slug,
      description: cmsTagTable.description,
      color: cmsTagTable.color,
      // Always the canonical anchor's locale (DEFAULT_LOCALE); localized views
      // overlay only name/description, so id/slug/locale stay canonical.
      locale: cmsTagTable.locale,
      createdBy: cmsTagTable.createdBy,
      createdAt: cmsTagTable.createdAt,
      updatedAt: cmsTagTable.updatedAt,
      updateCounter: cmsTagTable.updateCounter,
      entryCount: count(cmsEntryTagTable.id),
    })
    .from(cmsTagTable)
    .leftJoin(cmsEntryTagTable, eq(cmsTagTable.id, cmsEntryTagTable.tagId))
    .where(eq(cmsTagTable.locale, DEFAULT_LOCALE))
    .groupBy(cmsTagTable.id)
    .orderBy(desc(cmsTagTable.createdAt));

  if (locale === DEFAULT_LOCALE) {
    return tags;
  }

  const translations = await db
    .select({
      slug: cmsTagTable.slug,
      name: cmsTagTable.name,
      description: cmsTagTable.description,
    })
    .from(cmsTagTable)
    .where(eq(cmsTagTable.locale, locale));

  const translationBySlug = new Map(translations.map((row) => [row.slug, row]));

  return tags.map((tag) => {
    const translation = translationBySlug.get(tag.slug);
    return translation
      ? { ...tag, name: translation.name, description: translation.description }
      : tag;
  });
}

// Overlays localized name/description onto an entry's canonical tags for display
// in `locale`. Junctions reference canonical tag ids, so the localized tag view
// can fall back to canonical values by id.
export async function localizeEntryTags(
  tags: CmsEntryTagsForDisplay | undefined,
  locale: Locale,
): Promise<CmsEntryTagsForDisplay> {
  if (!shouldLocalizeEntryTags({ tags, locale })) {
    return tags ?? [];
  }

  const overlayById = await getLocalizedTagOverlayById(locale);

  return tags!.map((entryTag) => localizeEntryTag({ entryTag, overlayById }));
}

function shouldLocalizeEntryTags({
  tags,
  locale,
}: {
  tags: CmsEntryTagsForDisplay | undefined;
  locale: Locale;
}) {
  return Boolean(tags && tags.length > 0 && locale !== DEFAULT_LOCALE);
}

async function getLocalizedTagOverlayById(locale: Locale) {
  const localized = await getCmsTags({ locale });
  return new Map(localized.map((tag) => [tag.id, tag]));
}

function localizeEntryTag({
  entryTag,
  overlayById,
}: {
  entryTag: CmsEntryTagsForDisplay[number];
  overlayById: Awaited<ReturnType<typeof getLocalizedTagOverlayById>>;
}) {
  const overlay = overlayById.get(entryTag.tag.id);
  if (!overlay) {
    return entryTag;
  }

  return {
    ...entryTag,
    tag: { ...entryTag.tag, name: overlay.name, description: overlay.description },
  };
}

export const getCmsTagById = cache(async (id: string) => {
  const validated = v.parse(getCmsTagByIdParamsSchema, id);

  const db = getDB();
  return await db.query.cmsTagTable.findFirst({
    where: { id: validated },
  });
});

// Not cached: the editor must see a just-created sibling immediately.
export async function getCmsTagLocaleSiblings(
  slug: string
): Promise<CmsTagLocaleSibling[]> {
  const validated = v.parse(getCmsTagLocaleSiblingsParamsSchema, slug);

  const db = getDB();
  const rows = await db
    .select({
      id: cmsTagTable.id,
      locale: cmsTagTable.locale,
      name: cmsTagTable.name,
    })
    .from(cmsTagTable)
    .where(eq(cmsTagTable.slug, validated));

  return rows.map((row) => ({
    id: row.id,
    locale: row.locale,
    name: row.name,
  }));
}

// Map<slug, Set<locale>> of which locales each tag group covers. Powers the
// admin tags list translation-coverage column without a query per row.
export async function getCmsTagLocaleCoverage(): Promise<Map<string, Set<Locale>>> {
  const db = getDB();
  const rows = await db
    .selectDistinct({
      slug: cmsTagTable.slug,
      locale: cmsTagTable.locale,
    })
    .from(cmsTagTable);

  const coverage = new Map<string, Set<Locale>>();
  for (const row of rows) {
    const set = coverage.get(row.slug) ?? new Set<Locale>();
    set.add(row.locale);
    coverage.set(row.slug, set);
  }
  return coverage;
}

const getCachedCmsEntriesByTagId = cache(async (tagId: string, status: CmsStatusFilter) => {
  const db = getDB();

  const conditions = [eq(cmsEntryTagTable.tagId, tagId)];

  if (status !== CMS_STATUS_FILTER_ALL) {
    conditions.push(eq(cmsEntryTable.status, status));
  }

  const entries = await db
    .select({
      id: cmsEntryTable.id,
      title: cmsEntryTable.title,
      slug: cmsEntryTable.slug,
      collection: cmsEntryTable.collection,
      status: cmsEntryTable.status,
      createdAt: cmsEntryTable.createdAt,
      updatedAt: cmsEntryTable.updatedAt,
    })
    .from(cmsEntryTagTable)
    .innerJoin(cmsEntryTable, eq(cmsEntryTagTable.entryId, cmsEntryTable.id))
    .where(and(...conditions))
    .orderBy(desc(cmsEntryTable.updatedAt));

  return entries.reduce((acc, entry) => {
    if (!acc[entry.collection]) {
      acc[entry.collection] = [];
    }
    acc[entry.collection].push(entry);
    return acc;
  }, {} as Record<string, typeof entries>);
});

export function getCmsEntriesByTagId(params: GetCmsEntriesByTagIdParams) {
  const validated = v.parse(getCmsEntriesByTagIdParamsSchema, params);

  return getCachedCmsEntriesByTagId(validated.tagId, validated.status);
}
