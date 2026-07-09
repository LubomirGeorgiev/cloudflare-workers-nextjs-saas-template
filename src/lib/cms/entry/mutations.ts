import "server-only";

import { and, eq } from "drizzle-orm";
import type { JSONContent } from "@tiptap/core";

import { cmsConfig, type CollectionsUnion } from "@/../cms.config";
import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getDB } from "@/db";
import {
  cmsEntryMediaTable,
  cmsEntryTable,
  cmsEntryTagTable,
  cmsEntryVersionTable,
  type CmsEntry,
} from "@/db/schema";
import {
  invalidateCmsCollectionCache,
  invalidateCmsCollectionCountCache,
  invalidateCmsEntryCache,
  invalidateCmsNavigationCachesForCollection,
  invalidateCmsTagsCache,
  invalidateEntryAndCollection,
  invalidateSitemapCache,
} from "@/lib/cms/cms-cache-invalidation";
import {
  deleteCmsPublishSchedule,
  syncCmsPublishSchedule,
} from "@/lib/cms/cms-scheduled-publishing";
import {
  removeCmsEntrySearch,
  syncCmsEntrySearch,
} from "@/lib/cms/cms-search";
import {
  handlePublishedAt,
  validateEntryFields,
  validateSeoDescription,
} from "@/lib/cms/entry/helpers";
import {
  createCmsEntryParamsSchema,
  createCmsEntryTranslationParamsSchema,
  deleteCmsEntryParamsSchema,
  updateCmsEntryParamsSchema,
} from "@/lib/cms/entry/schemas";
import type {
  CreateCmsEntryParams,
  CreateCmsEntryTranslationParams,
  DeleteCmsEntryParams,
  UpdateCmsEntryParams,
} from "@/lib/cms/entry/types";
import { generateSeoDescription } from "@/lib/cms/generate-seo-description";
import { syncEntryMediaRelationships } from "@/lib/cms/media-tracking";
import { translateEntryFields } from "@/lib/cms/translate-entry";
import {
  computeEntryTranslatableHashes,
  computeStaleFields,
} from "@/lib/cms/translation-staleness";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/config";
import type { SourceContentHashes } from "@/types/cms";
import { requiredString, v } from "@/lib/validation";

export async function createCmsEntry<T extends CollectionsUnion>(
  params: CreateCmsEntryParams<T>
): Promise<CmsEntry> {
  const validated = v.parse(createCmsEntryParamsSchema, params);
  const { collectionSlug, slug, title, content, fields, seoDescription, status, publishedAt, createdBy, tagIds, featuredImageId } = validated;

  const db = getDB();

  const collection = cmsConfig.collections[collectionSlug as T];
  if (!collection) {
    throw new Error(`Collection "${String(collectionSlug)}" not found in CMS config`);
  }

  const validatedFields = validateEntryFields(fields, collection);

  let finalSeoDescription = seoDescription;
  if (!finalSeoDescription || finalSeoDescription.trim() === "") {
    const generatedDescription = await generateSeoDescription({
      title,
      content,
      collectionSlug: collection.slug as CollectionsUnion,
    });
    if (generatedDescription) {
      finalSeoDescription = generatedDescription;
    }
  }

  validateSeoDescription(finalSeoDescription);

  const existingEntry = await db.query.cmsEntryTable.findFirst({
    where: {
      collection: collection.slug as CollectionsUnion,
      slug,
    },
  });

  if (existingEntry) {
    throw new Error(`Entry with slug "${slug}" already exists in collection "${collection.slug}"`);
  }

  const finalPublishedAt = handlePublishedAt(status, publishedAt);

  const [newEntry] = await db.insert(cmsEntryTable).values({
    collection: collection.slug as CollectionsUnion,
    slug,
    title,
    content,
    fields: validatedFields,
    seoDescription: finalSeoDescription,
    status,
    publishedAt: finalPublishedAt,
    createdBy,
    featuredImageId,
  }).returning();

  if (tagIds && tagIds.length > 0) {
    await db.insert(cmsEntryTagTable).values(
      tagIds.map((tagId: string) => ({
        entryId: newEntry.id,
        tagId,
      }))
    );
  }

  await syncCreatedEntrySideEffects({ entry: newEntry });

  await syncCmsPublishSchedule(newEntry);

  return newEntry;
}

async function syncCreatedEntrySideEffects({
  entry,
}: {
  entry: CmsEntry;
}): Promise<void> {
  const collectionSlug = entry.collection as CollectionsUnion;

  await syncEntryMediaRelationships({
    entryId: entry.id,
    content: entry.content as JSONContent,
    featuredImageId: entry.featuredImageId,
  });

  await syncCmsEntrySearch({
    entryId: entry.id,
    collection: collectionSlug,
    slug: entry.slug,
    title: entry.title,
    seoDescription: entry.seoDescription,
    content: entry.content as JSONContent,
  });

  await Promise.all([
    invalidateCmsEntryCache({
      collectionSlug,
      slug: entry.slug,
    }),
    invalidateCmsCollectionCache({
      collectionSlug,
    }),
    invalidateCmsCollectionCountCache({
      collectionSlug,
    }),
    invalidateCmsNavigationCachesForCollection({
      collectionSlug,
    }),
    invalidateSitemapCache(),
    invalidateCmsTagsCache(),
  ]);
}

export async function updateCmsEntry(params: UpdateCmsEntryParams): Promise<CmsEntry | null> {
  const validated = v.parse(updateCmsEntryParamsSchema, params);
  const { id, slug, title, content, fields, seoDescription, status, publishedAt, tagIds, featuredImageId, sourceContentHashes } = validated;

  const db = getDB();

  const existingEntry = await db.query.cmsEntryTable.findFirst({
    where: { id: id },
  });

  if (!existingEntry) {
    throw new Error(`Entry with id "${id}" not found`);
  }

  const collection = cmsConfig.collections[existingEntry.collection as CollectionsUnion];
  if (!collection) {
    throw new Error(`Collection "${existingEntry.collection}" not found in CMS config`);
  }

  let validatedFields: unknown = undefined;
  if (fields !== undefined) {
    validatedFields = validateEntryFields(fields, collection);
  }

  let finalSeoDescription = seoDescription;

  // Auto-generate SEO only when the caller did not provide one and the entry lacks one.
  const finalTitle = title ?? existingEntry.title;
  const finalContent = content ?? existingEntry.content;
  const contentOrTitleChanged = content !== undefined || title !== undefined;
  const shouldGenerateSeo =
    finalSeoDescription === undefined &&
    contentOrTitleChanged &&
    (!existingEntry.seoDescription || existingEntry.seoDescription.trim() === "");

  if (shouldGenerateSeo) {
    const generatedDescription = await generateSeoDescription({
      title: finalTitle,
      content: finalContent as JSONContent,
      collectionSlug: existingEntry.collection,
    });
    if (generatedDescription) {
      finalSeoDescription = generatedDescription;
    }
  }

  validateSeoDescription(finalSeoDescription);

  const isSlugChanging = slug !== undefined && slug !== existingEntry.slug;

  if (isSlugChanging) {
    // This group's siblings all still hold the OLD slug here (the cascade below runs
    // after), so any row already on the new slug belongs to a DIFFERENT group — a
    // real conflict. No self-exclusion clause is needed.
    const [conflictingEntry] = await db
      .select({ id: cmsEntryTable.id })
      .from(cmsEntryTable)
      .where(
        and(
          eq(cmsEntryTable.collection, existingEntry.collection),
          eq(cmsEntryTable.slug, slug)
        )
      )
      .limit(1);

    if (conflictingEntry) {
      throw new Error(`Entry with slug "${slug}" already exists in collection "${existingEntry.collection}"`);
    }
  }

  const finalStatus = status ?? existingEntry.status;
  const finalPublishedAt = publishedAt !== undefined
    ? handlePublishedAt(finalStatus, publishedAt, existingEntry.publishedAt)
    : undefined;

  const updateData = {
    slug,
    title,
    content,
    fields: validatedFields,
    seoDescription: finalSeoDescription,
    status,
    publishedAt: finalPublishedAt,
    featuredImageId,
    sourceContentHashes,
  };

  const filteredUpdateData = Object.fromEntries(
    Object.entries(updateData).filter(([__, value]) => value !== undefined)
  );

  const [updatedEntry] = await db
    .update(cmsEntryTable)
    .set(filteredUpdateData)
    .where(eq(cmsEntryTable.id, id))
    .returning();

  if (isSlugChanging) {
    // Cascade the rename to every OTHER locale sibling on the old slug so the group
    // stays linked. Only the edited row above moved to the new slug and got a new
    // cms_entry_version snapshot; the siblings are not re-versioned.
    await db
      .update(cmsEntryTable)
      .set({ slug })
      .where(
        and(
          eq(cmsEntryTable.collection, existingEntry.collection),
          eq(cmsEntryTable.slug, existingEntry.slug)
        )
      );
  }

  if (tagIds) {
    await db.delete(cmsEntryTagTable).where(eq(cmsEntryTagTable.entryId, id));

    if (tagIds.length > 0) {
      await db.insert(cmsEntryTagTable).values(
        tagIds.map((tagId: string) => ({
          entryId: id,
          tagId,
        }))
      );
    }
  }

  if (content !== undefined || featuredImageId !== undefined) {
    await syncEntryMediaRelationships({
      entryId: id,
      content: content ?? existingEntry.content,
      featuredImageId: featuredImageId !== undefined ? featuredImageId : existingEntry.featuredImageId,
    });
  }

  const entriesToSyncSearch = isSlugChanging
    ? await db.query.cmsEntryTable.findMany({
        where: {
          collection: updatedEntry.collection,
          slug: updatedEntry.slug,
        },
      })
    : [updatedEntry];

  await Promise.all(
    entriesToSyncSearch.map((entry) =>
      syncCmsEntrySearch({
        entryId: entry.id,
        collection: entry.collection,
        slug: entry.slug,
        title: entry.title,
        seoDescription: entry.seoDescription,
        content: entry.content as JSONContent,
      })
    )
  );

  const latestVersion = await db.query.cmsEntryVersionTable.findFirst({
    where: { entryId: id },
    orderBy: { versionNumber: "desc" },
  });

  // Version 1 snapshots the pre-update state because entry creation skips duplicate history.
  if (!latestVersion) {
    await db.insert(cmsEntryVersionTable).values({
      entryId: id,
      versionNumber: 1,
      title: existingEntry.title,
      content: existingEntry.content as JSONContent,
      fields: existingEntry.fields,
      slug: existingEntry.slug,
      seoDescription: existingEntry.seoDescription,
      status: existingEntry.status,
      featuredImageId: existingEntry.featuredImageId,
      createdBy: existingEntry.createdBy,
    });
  }

  const nextVersionNumber = (latestVersion?.versionNumber ?? 1) + 1;
  const versionContent = content ?? existingEntry.content;
  const versionFields = validatedFields ?? existingEntry.fields;

  await db.insert(cmsEntryVersionTable).values({
    entryId: id,
    versionNumber: nextVersionNumber,
    title: title ?? existingEntry.title,
    content: versionContent as JSONContent,
    fields: versionFields,
    slug: slug ?? existingEntry.slug,
    seoDescription: finalSeoDescription ?? existingEntry.seoDescription,
    status: status ?? existingEntry.status,
    featuredImageId: featuredImageId !== undefined ? featuredImageId : existingEntry.featuredImageId,
    createdBy: existingEntry.createdBy, // Schema tracks the original author for version rows.
  });

  const oldSlug = existingEntry.slug;
  const newSlug = slug ?? oldSlug;
  const collectionSlug = existingEntry.collection;
  const slugsToInvalidate = new Set([oldSlug, newSlug]);

  await Promise.all([
    ...Array.from(slugsToInvalidate).map(slugToInvalidate =>
      invalidateCmsEntryCache({ collectionSlug, slug: slugToInvalidate })
    ),
    invalidateCmsCollectionCache({ collectionSlug }),
    invalidateCmsCollectionCountCache({ collectionSlug }),
    invalidateCmsNavigationCachesForCollection({ collectionSlug }),
    invalidateSitemapCache(),
    invalidateCmsTagsCache(),
  ]);

  await syncCmsPublishSchedule(updatedEntry);

  return updatedEntry || null;
}

export async function deleteCmsEntry(params: DeleteCmsEntryParams): Promise<void> {
  const validated = v.parse(deleteCmsEntryParamsSchema, params);
  const { id } = validated;

  const db = getDB();

  const existingEntry = await db.query.cmsEntryTable.findFirst({
    where: { id: id },
  });

  if (!existingEntry) {
    throw new Error(`Entry with id "${id}" not found`);
  }

  const collectionSlug = existingEntry.collection;
  const slug = existingEntry.slug;

  // Navigation anchors on the default-locale row (its `entryId` FK) and that same row is the i18n fallback
  // base, so deleting it must take the whole translation group: a surviving translation sibling would be
  // orphaned (no fallback) and its nav item cascades away regardless. Deleting a translation drops just that locale row. Mirrors deleteCmsTag's canonical-vs-translation policy.
  const entriesToDelete = existingEntry.locale === DEFAULT_LOCALE
    ? await db.query.cmsEntryTable.findMany({
        where: { collection: collectionSlug, slug },
      })
    : [existingEntry];

  for (const entry of entriesToDelete) {
    await db.delete(cmsEntryMediaTable).where(eq(cmsEntryMediaTable.entryId, entry.id));
    await db.delete(cmsEntryTable).where(eq(cmsEntryTable.id, entry.id));

    await removeCmsEntrySearch({ entryId: entry.id });
    await deleteCmsPublishSchedule(entry.id);
  }

  // Every sibling shares (collection, slug), so one invalidation covers the group.
  await invalidateEntryAndCollection({ collectionSlug, slug });
}

// Creates a new translation: a sibling row sharing (collection, slug) with a
// different locale, seeded as a DRAFT copy of the source content for a translator
// to edit in place. Does not touch the source row.
export async function createCmsEntryTranslation<T extends CollectionsUnion>(
  params: CreateCmsEntryTranslationParams
): Promise<CmsEntry & { aiTranslated: boolean }> {
  const validated = v.parse(createCmsEntryTranslationParamsSchema, params);
  const { collectionSlug, slug, sourceLocale, targetLocale, createdBy, autoTranslate } = validated;

  const db = getDB();

  const collection = cmsConfig.collections[collectionSlug as T];
  if (!collection) {
    throw new Error(`Collection "${String(collectionSlug)}" not found in CMS config`);
  }

  const sourceEntry = await db.query.cmsEntryTable.findFirst({
    where: {
      collection: collection.slug as CollectionsUnion,
      slug,
      locale: sourceLocale,
    },
  });

  if (!sourceEntry) {
    throw new Error(
      `Entry with slug "${slug}" and locale "${sourceLocale}" not found in collection "${collection.slug}"`
    );
  }

  const existingTranslation = await db.query.cmsEntryTable.findFirst({
    where: {
      collection: collection.slug as CollectionsUnion,
      slug,
      locale: targetLocale,
    },
  });

  if (existingTranslation) {
    throw new Error(
      `Entry with slug "${slug}" already has a "${targetLocale}" translation in collection "${collection.slug}"`
    );
  }

  // AI-translate the seeded copy from the source locale. The model never sees the
  // ProseMirror structure — only leaf strings are translated and written back —
  // and any failure falls back to a verbatim copy (see translateEntryFields).
  const translated = autoTranslate
    ? await translateEntryFields({
        title: sourceEntry.title,
        seoDescription: sourceEntry.seoDescription,
        content: sourceEntry.content as JSONContent,
        sourceLocale,
        targetLocale,
      })
    : {
        title: sourceEntry.title,
        seoDescription: sourceEntry.seoDescription,
        content: sourceEntry.content as JSONContent,
        translated: false,
      };

  // Snapshot the canonical (default-locale) source's content hashes so the editor can later detect when that
  // source drifts. Translating straight from the default locale means we already hold it; otherwise fetch it.
  // No default row, or the target IS the default locale → null (nothing canonical to be stale against).
  const defaultSourceEntry =
    sourceLocale === DEFAULT_LOCALE
      ? sourceEntry
      : await db.query.cmsEntryTable.findFirst({
          where: {
            collection: collection.slug as CollectionsUnion,
            slug,
            locale: DEFAULT_LOCALE,
          },
        });

  const sourceContentHashes: SourceContentHashes | null =
    targetLocale !== DEFAULT_LOCALE && defaultSourceEntry
      ? computeEntryTranslatableHashes({
          title: defaultSourceEntry.title,
          seoDescription: defaultSourceEntry.seoDescription,
          content: defaultSourceEntry.content as JSONContent,
        })
      : null;

  const [newEntry] = await db.insert(cmsEntryTable).values({
    collection: collection.slug as CollectionsUnion,
    slug,
    locale: targetLocale,
    title: translated.title,
    content: translated.content,
    fields: sourceEntry.fields,
    seoDescription: translated.seoDescription,
    featuredImageId: sourceEntry.featuredImageId,
    status: CMS_ENTRY_STATUS.DRAFT,
    createdBy,
    sourceContentHashes,
  }).returning();

  const sourceTags = await db.query.cmsEntryTagTable.findMany({
    where: { entryId: sourceEntry.id },
  });

  if (sourceTags.length > 0) {
    await db.insert(cmsEntryTagTable).values(
      sourceTags.map((sourceTag) => ({
        entryId: newEntry.id,
        tagId: sourceTag.tagId,
      }))
    );
  }

  await syncCreatedEntrySideEffects({ entry: newEntry });

  return { ...newEntry, aiTranslated: translated.translated };
}

// Loads a non-default translation row together with its canonical (default-locale)
// source, throwing if either is missing or if `id` points at the source row itself.
async function loadTranslationWithSource(id: string): Promise<{
  translationEntry: CmsEntry;
  sourceEntry: CmsEntry;
}> {
  const db = getDB();

  const translationEntry = await db.query.cmsEntryTable.findFirst({ where: { id } });
  if (!translationEntry) {
    throw new Error(`Entry with id "${id}" not found`);
  }
  if (translationEntry.locale === DEFAULT_LOCALE) {
    throw new Error("The default-locale entry is the source and is never out of date");
  }

  const sourceEntry = await db.query.cmsEntryTable.findFirst({
    where: {
      collection: translationEntry.collection as CollectionsUnion,
      slug: translationEntry.slug,
      locale: DEFAULT_LOCALE,
    },
  });
  if (!sourceEntry) {
    throw new Error(`No default-locale source found for "${translationEntry.slug}"`);
  }

  return { translationEntry, sourceEntry };
}

// Moves only the source-hash snapshot on a translation row — no content change, so
// (unlike updateCmsEntry) it creates no version-history row and needs no search/media
// re-sync. The editor's sibling read is uncached, so a refresh clears the stale flag.
async function snapshotSourceContentHashes(
  id: string,
  sourceContentHashes: SourceContentHashes
): Promise<CmsEntry | null> {
  const db = getDB();
  const [updated] = await db
    .update(cmsEntryTable)
    .set({ sourceContentHashes })
    .where(eq(cmsEntryTable.id, id))
    .returning();
  return updated ?? null;
}

// Re-translates a stale translation from the canonical source, overwriting only the fields that drifted,
// then re-snapshots the source hashes so the row reads as up to date. Translations are treated as
// disposable AI output (not hand-tuned), so overwriting is safe; translating only the changed fields avoids re-processing an unchanged body on a title-only edit.
export async function retranslateCmsEntry(params: { id: string }): Promise<CmsEntry | null> {
  const { id } = v.parse(v.object({ id: requiredString() }), params);

  const { translationEntry, sourceEntry } = await loadTranslationWithSource(id);

  const currentHashes = computeEntryTranslatableHashes({
    title: sourceEntry.title,
    seoDescription: sourceEntry.seoDescription,
    content: sourceEntry.content as JSONContent,
  });
  const staleFields = computeStaleFields({
    snapshot: translationEntry.sourceContentHashes,
    current: currentHashes,
  });

  // Nothing drifted (or no baseline) — just re-anchor the snapshot so any badge clears.
  if (staleFields.length === 0) {
    return snapshotSourceContentHashes(id, currentHashes);
  }

  // `locale` is a raw text column, so narrow it at runtime rather than trusting an
  // `as` cast: a row whose locale left the catalog (removed from LOCALES, or hand-inserted)
  // must fail loudly instead of firing a mis-targeted translation request.
  const targetLocale = translationEntry.locale;
  if (!isLocale(targetLocale)) {
    throw new Error(`Translation entry "${id}" has an unsupported locale: "${targetLocale}"`);
  }

  const translated = await translateEntryFields({
    title: sourceEntry.title,
    seoDescription: sourceEntry.seoDescription,
    content: sourceEntry.content as JSONContent,
    sourceLocale: DEFAULT_LOCALE,
    targetLocale,
    only: staleFields,
  });

  // Overwrite only the drifted fields; keep the existing translation for the rest.
  // Re-snapshot ALL hashes — the row is now aligned with the current source.
  return updateCmsEntry({
    id,
    title: staleFields.includes("title") ? translated.title : undefined,
    // updateCmsEntry treats undefined as "leave unchanged"; a null translated SEO
    // (source has none) maps to undefined rather than clearing, matching the form.
    seoDescription: staleFields.includes("seoDescription")
      ? translated.seoDescription ?? undefined
      : undefined,
    content: staleFields.includes("content") ? (translated.content as JSONContent) : undefined,
    sourceContentHashes: currentHashes,
  });
}

// Clears the stale flag without changing content: re-snapshots the current source
// hashes onto the translation. Escape hatch for when an admin has reconciled the
// translation by hand and just wants the badge to go away.
export async function markCmsEntryTranslationReviewed(
  params: { id: string }
): Promise<CmsEntry | null> {
  const { id } = v.parse(v.object({ id: requiredString() }), params);

  const { translationEntry, sourceEntry } = await loadTranslationWithSource(id);

  const currentHashes = computeEntryTranslatableHashes({
    title: sourceEntry.title,
    seoDescription: sourceEntry.seoDescription,
    content: sourceEntry.content as JSONContent,
  });

  return snapshotSourceContentHashes(translationEntry.id, currentHashes);
}
