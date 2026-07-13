import "server-only";

import { and, eq, ne } from "drizzle-orm";

import { getDB } from "@/db";
import { cmsTagTable, type CmsTag } from "@/db/schema";
import {
  getCmsTagGroupEntryRefs,
  invalidateCmsTagGroupCaches,
  type CmsEntryRef,
} from "@/lib/cms/cms-cache-invalidation";
import {
  createCmsTagParamsSchema,
  createCmsTagTranslationParamsSchema,
  deleteCmsTagParamsSchema,
  updateCmsTagParamsSchema,
} from "@/lib/cms/tags/schemas";
import type {
  CreateCmsTagParams,
  CreateCmsTagTranslationParams,
  DeleteCmsTagParams,
  UpdateCmsTagParams,
} from "@/lib/cms/tags/types";
import { translateTagFields } from "@/lib/cms/translate-entry";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import { v } from "@/lib/validation";

// Invalidate only what a tag write can affect. For deletes, the caller must pass
// `entryRefs` collected *before* the row (and its cascading junctions) is gone;
// create/update can resolve them from the live group slug here.
async function invalidateCmsTagMutationCaches({
  tagSlug,
  entryRefs,
}: {
  tagSlug?: string;
  entryRefs?: CmsEntryRef[];
}) {
  const refs = entryRefs ?? (tagSlug ? await getCmsTagGroupEntryRefs({ tagSlug }) : []);
  await invalidateCmsTagGroupCaches({ entryRefs: refs });
}

async function assertCanonicalTagSlugAvailable(slug: string) {
  const db = getDB();
  const existingTag = await db.query.cmsTagTable.findFirst({
    where: { slug, locale: DEFAULT_LOCALE },
  });

  if (existingTag) {
    throw new Error(`Tag with slug "${slug}" already exists`);
  }
}

async function getCmsTagOrThrow(id: string) {
  const db = getDB();
  const existingTag = await db.query.cmsTagTable.findFirst({
    where: { id },
  });

  if (!existingTag) {
    throw new Error(`Tag with id "${id}" not found`);
  }

  return existingTag;
}

async function assertTagNameAvailable({
  id,
  name,
  locale,
}: {
  id: string;
  name: string | undefined;
  locale: Locale;
}) {
  if (!name) {
    return;
  }

  const db = getDB();
  const conflictingName = await db.query.cmsTagTable.findFirst({
    where: { name, locale },
  });

  if (conflictingName && conflictingName.id !== id) {
    throw new Error(`A tag named "${name}" already exists`);
  }
}

async function assertTagGroupSlugAvailable({
  slug,
  existingSlug,
}: {
  slug: string;
  existingSlug: string;
}) {
  const db = getDB();
  const [conflictingTag] = await db
    .select({ id: cmsTagTable.id })
    .from(cmsTagTable)
    .where(and(eq(cmsTagTable.slug, slug), ne(cmsTagTable.slug, existingSlug)))
    .limit(1);

  if (conflictingTag) {
    throw new Error(`Tag with slug "${slug}" already exists`);
  }
}

async function cascadeTagGroupFields({
  existingTag,
  slug,
  color,
}: {
  existingTag: CmsTag;
  slug: string | undefined;
  color: string | undefined;
}) {
  await cascadeTagGroupSlug({
    existingSlug: existingTag.slug,
    slug,
  });
  await cascadeTagGroupColor({
    groupSlug: slug ?? existingTag.slug,
    existingColor: existingTag.color,
    color,
  });
}

// `slug` and `color` are group-level: cascade them to every sibling so the
// translation group stays linked and visually consistent.
async function cascadeTagGroupSlug({
  existingSlug,
  slug,
}: {
  existingSlug: string;
  slug: string | undefined;
}) {
  if (slug === undefined || slug === existingSlug) {
    return;
  }

  const db = getDB();
  await db
    .update(cmsTagTable)
    .set({ slug })
    .where(eq(cmsTagTable.slug, existingSlug));
}

async function cascadeTagGroupColor({
  groupSlug,
  existingColor,
  color,
}: {
  groupSlug: string;
  existingColor: string | null;
  color: string | undefined;
}) {
  if (color !== undefined && color !== existingColor) {
    const db = getDB();
    await db
      .update(cmsTagTable)
      .set({ color })
      .where(eq(cmsTagTable.slug, groupSlug));
  }
}

async function getSourceTagOrThrow({
  slug,
  sourceLocale,
}: {
  slug: string;
  sourceLocale: Locale;
}) {
  const db = getDB();
  const sourceTag = await db.query.cmsTagTable.findFirst({
    where: { slug, locale: sourceLocale },
  });

  if (!sourceTag) {
    throw new Error(`Tag with slug "${slug}" and locale "${sourceLocale}" not found`);
  }

  return sourceTag;
}

async function assertTagTranslationMissing({
  slug,
  targetLocale,
}: {
  slug: string;
  targetLocale: Locale;
}) {
  const db = getDB();
  const existingTranslation = await db.query.cmsTagTable.findFirst({
    where: { slug, locale: targetLocale },
  });

  if (existingTranslation) {
    throw new Error(`Tag "${slug}" already has a "${targetLocale}" translation`);
  }
}

async function translateCmsTagForLocale({
  sourceTag,
  sourceLocale,
  targetLocale,
  autoTranslate,
}: {
  sourceTag: CmsTag;
  sourceLocale: Locale;
  targetLocale: Locale;
  autoTranslate: boolean;
}) {
  if (!autoTranslate) {
    return {
      name: sourceTag.name,
      description: sourceTag.description,
      translated: false,
    };
  }

  return await translateTagFields({
    name: sourceTag.name,
    description: sourceTag.description,
    sourceLocale,
    targetLocale,
  });
}

async function assertTranslatedTagNameAvailable({
  name,
  targetLocale,
}: {
  name: string;
  targetLocale: Locale;
}) {
  const db = getDB();
  const conflictingName = await db.query.cmsTagTable.findFirst({
    where: { name, locale: targetLocale },
  });

  if (conflictingName) {
    throw new Error(`A tag named "${name}" already exists in "${targetLocale}"`);
  }
}

export async function createCmsTag(params: CreateCmsTagParams) {
  const validated = v.parse(createCmsTagParamsSchema, params);
  const { name, slug, description, color, createdBy } = validated;

  const db = getDB();

  await assertCanonicalTagSlugAvailable(slug);

  const [newTag] = await db.insert(cmsTagTable).values({
    name,
    slug,
    description,
    color,
    locale: DEFAULT_LOCALE,
    createdBy,
  }).returning();

  // Brand-new canonical tag: no entries reference it yet, so this only busts the
  // tags catalog + sitemap.
  await invalidateCmsTagMutationCaches({ tagSlug: slug });

  return newTag;
}

export async function updateCmsTag(params: UpdateCmsTagParams) {
  const validated = v.parse(updateCmsTagParamsSchema, params);
  const { id, name, slug, description, color } = validated;

  const db = getDB();

  const existingTag = await getCmsTagOrThrow(id);

  // `name` is per-locale; guard uniqueness within this row's locale.
  await assertTagNameAvailable({
    id,
    name: name === existingTag.name ? undefined : name,
    locale: existingTag.locale,
  });

  const isSlugChanging = slug !== undefined && slug !== existingTag.slug;

  if (isSlugChanging) {
    // Siblings sharing existingTag.slug form the translation group and cascade to
    // the same new slug below, so only a different group using it is a conflict.
    await assertTagGroupSlugAvailable({ slug, existingSlug: existingTag.slug });
  }

  const [updatedTag] = await db
    .update(cmsTagTable)
    .set({
      name,
      slug,
      description,
      color,
    })
    .where(eq(cmsTagTable.id, id))
    .returning();

  await cascadeTagGroupFields({ existingTag, slug, color });

  // After the cascade the whole group shares the new slug, so resolve affected
  // entries by it (falls back to the unchanged slug when only name/description moved).
  await invalidateCmsTagMutationCaches({ tagSlug: slug ?? existingTag.slug });

  return updatedTag;
}

export async function deleteCmsTag(id: DeleteCmsTagParams) {
  const validated = v.parse(deleteCmsTagParamsSchema, id);

  const db = getDB();

  const existingTag = await db.query.cmsTagTable.findFirst({
    where: { id: validated },
  });

  if (!existingTag) {
    return undefined;
  }

  // Collect the entries that reference this tag before the delete cascades the
  // junction rows away — afterward they'd be unrecoverable for invalidation.
  const entryRefs = await getCmsTagGroupEntryRefs({ tagSlug: existingTag.slug });

  if (existingTag.locale === DEFAULT_LOCALE) {
    // Deleting the canonical tag removes the whole translation group; junction
    // rows reference the canonical id and cascade-delete the tag from entries.
    await db.delete(cmsTagTable).where(eq(cmsTagTable.slug, existingTag.slug));
  } else {
    // Deleting a translation drops just that locale; junctions are untouched.
    await db.delete(cmsTagTable).where(eq(cmsTagTable.id, validated));
  }

  await invalidateCmsTagMutationCaches({ entryRefs });

  return existingTag;
}

// Creates a translation of a canonical tag: a sibling row sharing `slug`/`color`
// with a different locale and an AI-translated (or verbatim) name/description.
export async function createCmsTagTranslation(
  params: CreateCmsTagTranslationParams
) {
  const validated = v.parse(createCmsTagTranslationParamsSchema, params);
  const { slug, sourceLocale, targetLocale, createdBy, autoTranslate } = validated;

  const db = getDB();

  const sourceTag = await getSourceTagOrThrow({ slug, sourceLocale });
  await assertTagTranslationMissing({ slug, targetLocale });
  const translated = await translateCmsTagForLocale({
    sourceTag,
    sourceLocale,
    targetLocale,
    autoTranslate,
  });

  // `name` is unique per locale; surface a clear error rather than hitting the
  // DB constraint for a different tag already owning the translated name.
  await assertTranslatedTagNameAvailable({ name: translated.name, targetLocale });

  const [newTag] = await db.insert(cmsTagTable).values({
    name: translated.name,
    slug: sourceTag.slug,
    description: translated.description,
    color: sourceTag.color,
    locale: targetLocale,
    createdBy,
  }).returning();

  await invalidateCmsTagMutationCaches({ tagSlug: sourceTag.slug });

  return { ...newTag, aiTranslated: translated.translated };
}
