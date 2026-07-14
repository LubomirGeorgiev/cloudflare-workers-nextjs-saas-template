"use server";

import { ActionError } from "@/lib/action-error";
import { actionClient } from "@/lib/safe-action";
import { requireAdmin } from "@/utils/auth";
import { collectionSchema, type CollectionsUnion } from "@/../cms.config";
import { createCmsEntrySchema, updateCmsEntrySchema } from "@/schemas/cms-entry.schema";
import {
  getFreshCmsCollection,
  getFreshCmsCollectionCount,
  createCmsEntry,
  updateCmsEntry,
  deleteCmsEntry,
  getCmsEntryById,
  getEntryLocalesForSlugs,
  createCmsEntryTranslation,
  retranslateCmsEntry,
  markCmsEntryTranslationReviewed,
  type CmsCollectionListItem,
} from "@/lib/cms/entry";
import { generateSeoDescription } from "@/lib/cms/generate-seo-description";
import { revalidateCmsEntryPaths } from "@/app/(admin)/admin/_actions/cms-entry-revalidation";
import { cmsStatusFilterTuple } from "@/types/cms";
import { requiredString, v } from "@/lib/validation";
import { DEFAULT_LOCALE, ENABLED_LOCALES, LOCALES, isLocale, type Locale } from "@/i18n/config";

const listStatusEnum = v.picklist(cmsStatusFilterTuple);

// A listed entry augmented with translation-group coverage for its (collection, slug): the enabled locales
// still missing (so the table can flag incomplete translations) and the total number of locale rows in the
// group (so the delete dialog can state the true blast radius — a default-locale delete cascades the whole group — independent of which siblings happen to be on the loaded page). Kept at the action boundary rather than on the shared read type, since only this listing populates it.
export type CmsEntryListRow = CmsCollectionListItem & {
  missingLocales: Locale[];
  translationGroupSize: number;
};

export const listCmsEntriesAction = actionClient
  .inputSchema(
    v.object({
      collection: collectionSchema,
      status: v.optional(listStatusEnum, "all"),
      limit: v.optional(v.number(), 20),
      offset: v.optional(v.number(), 0),
    })
  )
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    // The admin table must list every locale's rows: a new non-default-locale DRAFT
    // translation otherwise has no row to edit/publish, since getCmsCollection /
    // getCmsCollectionCount default to locale-filtered (DEFAULT_LOCALE) for public callers.
    const [entries, totalCount] = await Promise.all([
      getFreshCmsCollection({
        collectionSlug: input.collection,
        status: input.status,
        limit: input.limit,
        offset: input.offset,
        allLocales: true,
        includeRelations: {
          createdByUser: true,
          tags: true,
        },
      }),
      getFreshCmsCollectionCount({
        collectionSlug: input.collection,
        status: input.status,
        allLocales: true,
      }),
    ]);

    // Annotate each row with the enabled locales missing from its (collection, slug) translation group, so the
    // table can flag incomplete translations. When i18n is disabled, ENABLED_LOCALES is just the default
    // locale, so this is a no-op (nothing is ever "missing").
    const coverage = await getEntryLocalesForSlugs({
      collectionSlug: input.collection,
      slugs: entries.map((entry) => entry.slug),
    });

    const entriesWithCoverage: CmsEntryListRow[] = entries.map((entry) => {
      const present = coverage.get(entry.slug) ?? new Set();
      return {
        ...entry,
        missingLocales: ENABLED_LOCALES.filter((locale) => !present.has(locale)),
        // Total locale rows in the group (all present locales, not just enabled
        // ones) — the delete cascade drops every one of them.
        translationGroupSize: present.size || 1,
      };
    });

    return { entries: entriesWithCoverage, totalCount };
  });

export const createCmsEntryAction = actionClient
  .inputSchema(createCmsEntrySchema)
  .action(async ({ parsedInput: input }) => {
    const session = await requireAdmin();

    if (!session?.userId) {
      throw new ActionError("FORBIDDEN", "Not authorized");
    }

    const newEntry = await createCmsEntry({
      ...input,
      collectionSlug: input.collection as CollectionsUnion,
      createdBy: session.userId,
    });

    revalidateCmsEntryPaths({
      collection: input.collection as CollectionsUnion,
      entryId: newEntry.id,
      slugs: [newEntry.slug],
      includeCreatePath: true,
    });

    return newEntry;
  });

export const updateCmsEntryAction = actionClient
  .inputSchema(updateCmsEntrySchema)
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const previousEntry = await getCmsEntryById({ id: input.id });
    const updatedEntry = await updateCmsEntry(input);

    if (!updatedEntry) {
      throw new ActionError("NOT_FOUND", "Entry not found");
    }

    revalidateCmsEntryPaths({
      collection: updatedEntry.collection as CollectionsUnion,
      entryId: updatedEntry.id,
      slugs: [previousEntry?.slug, updatedEntry.slug].filter((slug): slug is string => Boolean(slug)),
    });

    return updatedEntry;
  });

export const deleteCmsEntryAction = actionClient
  .inputSchema(v.object({ id: v.string() }))
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const deletedEntry = await deleteCmsEntry({ id: input.id });

    revalidateCmsEntryPaths({
      collection: deletedEntry.collection as CollectionsUnion,
      entryId: deletedEntry.id,
      slugs: [deletedEntry.slug],
    });

    return { success: true };
  });

export const createTranslationAction = actionClient
  .inputSchema(
    v.object({
      collection: collectionSchema,
      slug: requiredString("Slug is required"),
      // Source can be any catalog locale (the row must already exist); the target
      // is restricted to served locales — with i18n disabled this rejects creating
      // orphan translations that would never be routed to.
      sourceLocale: v.picklist(LOCALES),
      targetLocale: v.picklist(ENABLED_LOCALES),
      // Auto-translate the seeded copy by default; pass false for a verbatim copy.
      autoTranslate: v.optional(v.boolean(), true),
    })
  )
  .action(async ({ parsedInput: input }) => {
    const session = await requireAdmin();

    if (!session?.userId) {
      throw new ActionError("FORBIDDEN", "Not authorized");
    }

    const newEntry = await createCmsEntryTranslation({
      collectionSlug: input.collection as CollectionsUnion,
      slug: input.slug,
      sourceLocale: input.sourceLocale,
      targetLocale: input.targetLocale,
      createdBy: session.userId,
      autoTranslate: input.autoTranslate,
    });

    revalidateCmsEntryPaths({
      collection: input.collection as CollectionsUnion,
      entryId: newEntry.id,
      slugs: [newEntry.slug],
    });

    return newEntry;
  });

// Refreshes a stale translation: re-translates the drifted fields from the source and
// re-anchors its staleness snapshot. Overwrites AI output in place (translations are
// not hand-tuned in this template).
export const retranslateTranslationAction = actionClient
  .inputSchema(v.object({ id: requiredString("Entry ID is required") }))
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const updated = await retranslateCmsEntry({ id: input.id });

    if (!updated) {
      throw new ActionError("NOT_FOUND", "Entry not found");
    }

    revalidateCmsEntryPaths({
      collection: updated.collection as CollectionsUnion,
      entryId: updated.id,
      slugs: [updated.slug],
    });

    return updated;
  });

// Clears the stale flag without changing content — for when an admin has reconciled
// the translation by hand and only wants the badge to go away.
export const markTranslationReviewedAction = actionClient
  .inputSchema(v.object({ id: requiredString("Entry ID is required") }))
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const updated = await markCmsEntryTranslationReviewed({ id: input.id });

    if (!updated) {
      throw new ActionError("NOT_FOUND", "Entry not found");
    }

    revalidateCmsEntryPaths({
      collection: updated.collection as CollectionsUnion,
      entryId: updated.id,
      slugs: [updated.slug],
    });

    return updated;
  });

export const generateSeoDescriptionAction = actionClient
  .inputSchema(
    v.object({
      id: requiredString("Entry ID is required"),
    })
  )
  .action(async ({ parsedInput: input }) => {
    await requireAdmin();

    const entry = await getCmsEntryById({ id: input.id });

    if (!entry) {
      throw new ActionError("NOT_FOUND", "Entry not found");
    }

    const description = await generateSeoDescription({
      title: entry.title,
      content: entry.content,
      collectionSlug: entry.collection,
      locale: isLocale(entry.locale) ? entry.locale : DEFAULT_LOCALE,
    });

    if (!description) {
      throw new ActionError("INTERNAL_SERVER_ERROR", "Failed to generate SEO description");
    }

    return { description };
  });
