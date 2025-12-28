import "server-only";

import { cache } from "react";
import { eq, and, desc, count } from "drizzle-orm";
import type { JSONContent } from "@tiptap/core";

import { getDB } from "@/db"
import { cmsConfig, CollectionsUnion } from "@/../cms.config";
import { cmsEntryTable, cmsEntryMediaTable, cmsTagTable, cmsEntryTagTable, type CmsEntry, type CmsTag } from "@/db/schema";
import { CMS_ENTRY_STATUS } from "@/app/enums";
import { withKVCache } from "@/utils/with-kv-cache";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { generateSeoDescription } from "@/lib/cms/generate-seo-description";
import { syncEntryMediaRelationships } from "@/lib/cms/media-tracking";

// TODO Add tags list to blog posts
// TODO Add authors to blog posts
// TODO Automatically add cms entries to the sitemap and also add the option to hide certain entries from the sitemap
// TODO Explain how to use the CMS in the README.md file
// TODO Add version history
// TODO Add scheduled publishing
// TODO Uploading images from the editor and a dedicated media collection admin page

// Extend CMS_ENTRY_STATUS with 'all' option for queries
export type CmsEntryStatus = typeof CMS_ENTRY_STATUS[keyof typeof CMS_ENTRY_STATUS];

function getCmsEntryCacheKey({
  collectionSlug,
  slug,
  status,
}: {
  collectionSlug: CollectionsUnion;
  slug: string;
  status?: CmsEntryStatus | 'all';
}): string {
  const base = `cms:entry:${collectionSlug}:${slug}`;
  return status ? `${base}:${status}` : base;
}

async function invalidateCmsEntryCache({
  collectionSlug,
  slug,
}: {
  collectionSlug: CollectionsUnion;
  slug: string;
}): Promise<void> {
  const { env } = await getCloudflareContext({ async: true });
  const kv = env.NEXT_INC_CACHE_KV;

  if (!kv) {
    return;
  }

  const prefix = getCmsEntryCacheKey({ collectionSlug, slug });
  const keys = await kv.list({ prefix });

  await Promise.all(keys.keys.map(key => kv.delete(key.name)));
}

type CmsIncludeRelations = {
  createdByUser?: boolean;
  media?: boolean;
  tags?: boolean;
};

/**
 * Helper function to build the 'with' clause for including relations in CMS queries
 */
function buildCmsRelationsQuery(includeRelations?: CmsIncludeRelations) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const relations = {} as Record<string, any>;

  if (includeRelations?.createdByUser) {
    relations.createdByUser = {
      columns: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        avatar: true,
      },
    };
  }

  if (includeRelations?.media) {
    relations.entryMedia = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      orderBy: (fields: any, { asc }: any) => [asc(fields.position)],
      with: {
        media: true,
      },
    };
  }

  if (includeRelations?.tags) {
    relations.tags = {
      with: {
        tag: true,
      },
    };
  }

  return relations;
}

type GetCmsCollectionParams<T extends CollectionsUnion> = {
  collectionSlug: T;
  /**
   * Filter by status. Defaults to 'published' only.
   * Pass 'all' to get entries with any status.
   */
  status?: CmsEntryStatus | 'all';
  /**
   * Include relations in the query
   */
  includeRelations?: CmsIncludeRelations;
  /**
   * Limit the number of entries returned
   */
  limit?: number;
  /**
   * Offset for pagination
   */
  offset?: number;
};

export type GetCmsCollectionResult = CmsEntry & {
  status: CmsEntryStatus;
  createdByUser?: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    avatar: string | null;
  };
  entryMedia?: Array<{
    id: string;
    position: number | null;
    caption: string | null;
    media: {
      id: string;
      fileName: string;
      mimeType: string;
      sizeInBytes: number;
      bucketKey: string;
      width: number | null;
      height: number | null;
      alt: string | null;
    };
  }>;
  tags?: Array<{
    tag: CmsTag;
  }>;
};

/**
 * Get multiple CMS entries from a collection (for list/archive pages)
 *
 * @example
 * // Get all published blog posts
 * const posts = await getCmsCollection({
 *   collectionSlug: 'blog',
 *   limit: 10,
 *   includeRelations: { media: true }
 * });
 */
export const getCmsCollection = cache(async <T extends keyof typeof cmsConfig.collections>({
  collectionSlug,
  status = CMS_ENTRY_STATUS.PUBLISHED,
  includeRelations,
  limit,
  offset,
}: GetCmsCollectionParams<T>): Promise<GetCmsCollectionResult[]> => {
  const db = getDB();

  const collection = cmsConfig.collections[collectionSlug];
  if (!collection) {
    throw new Error(`Collection "${String(collectionSlug)}" not found in CMS config`);
  }

  const whereConditions = [
    eq(cmsEntryTable.collection, collection.slug as CollectionsUnion),
  ];

  if (status !== 'all') {
    whereConditions.push(eq(cmsEntryTable.status, status));
  }

  const query = db.query.cmsEntryTable.findMany({
    where: and(...whereConditions),
    orderBy: [desc(cmsEntryTable.createdAt)],
    limit: limit,
    offset: offset,
    with: buildCmsRelationsQuery(includeRelations),
  });

  const entries = await query;

  return entries as GetCmsCollectionResult[];
});

/**
 * Get the total count of CMS entries in a collection
 *
 * @example
 * // Get total count of blog posts
 * const count = await getCmsCollectionCount({
 *   collectionSlug: 'blog',
 *   status: 'published'
 * });
 */
export const getCmsCollectionCount = cache(async <T extends keyof typeof cmsConfig.collections>({
  collectionSlug,
  status = CMS_ENTRY_STATUS.PUBLISHED,
}: {
  collectionSlug: T;
  status?: CmsEntryStatus | 'all';
}): Promise<number> => {
  const db = getDB();

  const collection = cmsConfig.collections[collectionSlug];
  if (!collection) {
    throw new Error(`Collection "${String(collectionSlug)}" not found in CMS config`);
  }

  const whereConditions = [
    eq(cmsEntryTable.collection, collection.slug as CollectionsUnion),
  ];

  if (status !== 'all') {
    whereConditions.push(eq(cmsEntryTable.status, status));
  }

  const result = await db
    .select({ count: count() })
    .from(cmsEntryTable)
    .where(and(...whereConditions));

  return result[0]?.count ?? 0;
});


type GetCmsEntryByIdParams = {
  id: string;
  /**
   * Include relations in the query
   */
  includeRelations?: CmsIncludeRelations;
};

/**
 * Get a single CMS entry by ID (for admin/edit interfaces)
 *
 * Use this when you have the entry ID directly, typically in admin panels
 * or when editing content. This bypasses status filtering.
 *
 * @example
 * // Get an entry by ID for editing
 * const entry = await getCmsEntryById({
 *   id: 'cms_ent_abc123',
 *   includeRelations: { createdByUser: true, media: true }
 * });
 */
export const getCmsEntryById = cache(async ({
  id,
  includeRelations,
}: GetCmsEntryByIdParams): Promise<GetCmsCollectionResult | null> => {
  const db = getDB();

  const entry = await db.query.cmsEntryTable.findFirst({
    where: eq(cmsEntryTable.id, id),
    with: buildCmsRelationsQuery(includeRelations),
  });

  return entry as GetCmsCollectionResult | null;
});

type GetCmsEntryBySlugParams<T extends keyof typeof cmsConfig.collections> = {
  collectionSlug: T;
  slug: string;
  status?: CmsEntryStatus | 'all';
  includeRelations?: CmsIncludeRelations;
};

type GetCmsEntryBySlugResult = GetCmsCollectionResult;

/**
 * Get a single CMS entry by slug (for public-facing pages like blog posts)
 *
 * Returns the raw JSON content for rendering with CmsContentRenderer component.
 * Results are cached in Cloudflare KV for performance.
 *
 * @example
 * // Get a published blog post by slug
 * const post = await getCmsEntryBySlug({
 *   collectionSlug: 'blog',
 *   slug: 'my-first-post',
 *   includeRelations: { createdByUser: true, tags: true }
 * });
 */
export async function getCmsEntryBySlug<T extends keyof typeof cmsConfig.collections>({
  collectionSlug,
  slug,
  status = CMS_ENTRY_STATUS.PUBLISHED,
  includeRelations,
}: GetCmsEntryBySlugParams<T>): Promise<GetCmsEntryBySlugResult | null> {
  const collection = cmsConfig.collections[collectionSlug];
  if (!collection) {
    throw new Error(`Collection "${String(collectionSlug)}" not found in CMS config`);
  }

  const cacheKey = getCmsEntryCacheKey({
    collectionSlug: collection.slug as CollectionsUnion,
    slug,
    status,
  });

  return withKVCache(
    async () => {
      const db = getDB();

      const whereConditions = [
        eq(cmsEntryTable.collection, collection.slug as CollectionsUnion),
        eq(cmsEntryTable.slug, slug),
      ];

      if (status !== 'all') {
        whereConditions.push(eq(cmsEntryTable.status, status));
      }

      const entry = await db.query.cmsEntryTable.findFirst({
        where: and(...whereConditions),
        with: buildCmsRelationsQuery(includeRelations),
      });

      if (!entry) {
        return null;
      }

      return entry as GetCmsCollectionResult;
    },
    {
      key: cacheKey,
      ttl: '7 days',
    }
  );
}

type CreateCmsEntryParams<T extends keyof typeof cmsConfig.collections> = {
  collectionSlug: T;
  slug: string;
  title: string;
  /**
   * The main content of the entry (e.g., rich text, markdown, etc.)
   */
  content: JSONContent;
  /**
   * Custom fields specific to the collection (e.g., excerpt, author, tags, etc.)
   */
  fields: unknown;
  /**
   * SEO meta description (max 160 characters). If not provided, will be auto-generated using AI.
   */
  seoDescription?: string;
  status?: CmsEntryStatus;
  createdBy: string;
  tagIds?: string[];
};

/**
 * Create a new CMS entry
 *
 * @example
 * // Create a new blog post
 * const newPost = await createCmsEntry({
 *   collectionSlug: 'blog',
 *   slug: 'my-first-post',
 *   title: 'My First Post',
 *   content: '<p>Main content here...</p>',
 *   fields: { excerpt: 'A brief summary', tags: ['tutorial', 'nextjs'] },
 *   status: CMS_ENTRY_STATUS.DRAFT,
 *   createdBy: userId,
 * });
 */
export async function createCmsEntry<T extends keyof typeof cmsConfig.collections>({
  collectionSlug,
  slug,
  title,
  content,
  fields,
  seoDescription,
  status = CMS_ENTRY_STATUS.DRAFT,
  createdBy,
  tagIds,
}: CreateCmsEntryParams<T>): Promise<CmsEntry> {
  const db = getDB();

  const collection = cmsConfig.collections[collectionSlug];
  if (!collection) {
    throw new Error(`Collection "${String(collectionSlug)}" not found in CMS config`);
  }

  // Validate fields using Zod schema if provided
  let validatedFields = fields;
  if (collection.fieldsSchema) {
    const parseResult = collection.fieldsSchema.safeParse(fields);
    if (!parseResult.success) {
      throw new Error(`Invalid fields: ${parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
    }
    validatedFields = parseResult.data;
  }

  // Auto-generate SEO description if not provided
  let finalSeoDescription = seoDescription;
  if (!finalSeoDescription || finalSeoDescription.trim() === '') {
    const generatedDescription = await generateSeoDescription({
      title,
      content,
      collectionSlug: collection.slug as CollectionsUnion,
    });
    if (generatedDescription) {
      finalSeoDescription = generatedDescription;
    }
  }

  // Validate SEO description length
  if (finalSeoDescription && finalSeoDescription.length > 160) {
    throw new Error(`SEO description exceeds maximum length of 160 characters (got ${finalSeoDescription.length})`);
  }

  const existingEntry = await db.query.cmsEntryTable.findFirst({
    where: and(
      eq(cmsEntryTable.collection, collection.slug as CollectionsUnion),
      eq(cmsEntryTable.slug, slug)
    ),
  });

  if (existingEntry) {
    throw new Error(`Entry with slug "${slug}" already exists in collection "${collection.slug}"`);
  }

  const [newEntry] = await db.insert(cmsEntryTable).values({
    collection: collection.slug as CollectionsUnion,
    slug,
    title,
    content,
    fields: validatedFields,
    seoDescription: finalSeoDescription,
    status,
    createdBy,
  }).returning();

  if (tagIds && tagIds.length > 0) {
    await db.insert(cmsEntryTagTable).values(
      tagIds.map(tagId => ({
        entryId: newEntry.id,
        tagId,
      }))
    );
  }

  // Sync media relationships based on content
  await syncEntryMediaRelationships({
    entryId: newEntry.id,
    content,
  });

  return newEntry;
}

type UpdateCmsEntryParams = {
  id: string;
  slug?: string;
  title?: string;
  /**
   * The main content of the entry (e.g., rich text, markdown, etc.)
   */
  content?: JSONContent;
  /**
   * Custom fields specific to the collection (e.g., excerpt, author, tags, etc.)
   */
  fields?: unknown;
  /**
   * SEO meta description (max 160 characters). If not provided and content/title changed, will be auto-generated using AI.
   */
  seoDescription?: string;
  status?: CmsEntryStatus;
  tagIds?: string[];
};

/**
 * Update an existing CMS entry
 *
 * @example
 * // Update a blog post
 * const updatedPost = await updateCmsEntry({
 *   id: 'cms_ent_abc123',
 *   title: 'Updated Title',
 *   content: '<p>Updated content...</p>',
 *   fields: { excerpt: 'Updated summary', tags: ['tutorial', 'nextjs', 'updated'] },
 *   status: CMS_ENTRY_STATUS.PUBLISHED,
 * });
 */
export async function updateCmsEntry({
  id,
  slug,
  title,
  content,
  fields,
  seoDescription,
  status,
  tagIds,
}: UpdateCmsEntryParams): Promise<CmsEntry | null> {
  const db = getDB();

  const existingEntry = await db.query.cmsEntryTable.findFirst({
    where: eq(cmsEntryTable.id, id),
  });

  if (!existingEntry) {
    throw new Error(`Entry with id "${id}" not found`);
  }

  const collection = cmsConfig.collections[existingEntry.collection as keyof typeof cmsConfig.collections];
  if (!collection) {
    throw new Error(`Collection "${existingEntry.collection}" not found in CMS config`);
  }

  // Use provided fields or keep existing ones (don't merge to allow field deletion)
  const finalFields = fields !== undefined ? fields : existingEntry.fields;

  // Validate fields using Zod schema if provided
  let validatedFields = finalFields;
  if (collection.fieldsSchema) {
    const parseResult = collection.fieldsSchema.safeParse(finalFields);
    if (!parseResult.success) {
      throw new Error(`Invalid fields: ${parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
    }
    validatedFields = parseResult.data;
  }

  // Determine final SEO description
  let finalSeoDescription = seoDescription;

  // Auto-generate SEO description if:
  // 1. Not explicitly provided (undefined)
  // 2. Content or title changed
  // 3. Current description is empty
  const finalTitle = title ?? existingEntry.title;
  const finalContent = content ?? existingEntry.content;
  const contentOrTitleChanged = content !== undefined || title !== undefined;
  const shouldGenerateSeo =
    finalSeoDescription === undefined &&
    contentOrTitleChanged &&
    (!existingEntry.seoDescription || existingEntry.seoDescription.trim() === '');

  if (shouldGenerateSeo) {
    const generatedDescription = await generateSeoDescription({
      title: finalTitle,
      content: finalContent as JSONContent,
      collectionSlug: existingEntry.collection,
    });
    if (generatedDescription) {
      finalSeoDescription = generatedDescription;
    }
  } else if (finalSeoDescription === undefined) {
    // Keep existing SEO description if not provided and nothing changed
    finalSeoDescription = existingEntry.seoDescription ?? undefined;
  }

  // Validate SEO description length
  if (finalSeoDescription && finalSeoDescription.length > 160) {
    throw new Error(`SEO description exceeds maximum length of 160 characters (got ${finalSeoDescription.length})`);
  }

  if (slug && slug !== existingEntry.slug) {
    const conflictingEntry = await db.query.cmsEntryTable.findFirst({
      where: and(
        eq(cmsEntryTable.collection, existingEntry.collection),
        eq(cmsEntryTable.slug, slug)
      ),
    });

    if (conflictingEntry) {
      throw new Error(`Entry with slug "${slug}" already exists in collection "${existingEntry.collection}"`);
    }
  }

  const [updatedEntry] = await db
    .update(cmsEntryTable)
    .set({
      slug: slug,
      title: title,
      content: content,
      fields: validatedFields,
      seoDescription: finalSeoDescription,
      status: status,
    })
    .where(eq(cmsEntryTable.id, id))
    .returning();

  if (tagIds) {
    await db.delete(cmsEntryTagTable).where(eq(cmsEntryTagTable.entryId, id));

    if (tagIds.length > 0) {
      await db.insert(cmsEntryTagTable).values(
        tagIds.map(tagId => ({
          entryId: id,
          tagId,
        }))
      );
    }
  }

  // Sync media relationships if content changed
  if (content !== undefined) {
    await syncEntryMediaRelationships({
      entryId: id,
      content,
    });
  }

  const oldSlug = existingEntry.slug;
  const newSlug = slug ?? oldSlug;
  const collectionSlug = existingEntry.collection;

  const slugsToInvalidate = new Set([oldSlug, newSlug]);
  await Promise.all(
    Array.from(slugsToInvalidate).map(slugToInvalidate =>
      invalidateCmsEntryCache({ collectionSlug, slug: slugToInvalidate })
    )
  );

  return updatedEntry || null;
}

type DeleteCmsEntryParams = {
  id: string;
};

/**
 * Delete a CMS entry and its associated media relations
 *
 * Note: This does not delete the actual media files, only the associations.
 *
 * @example
 * // Delete a blog post
 * await deleteCmsEntry({ id: 'cms_ent_abc123' });
 */
export async function deleteCmsEntry({
  id,
}: DeleteCmsEntryParams): Promise<void> {
  const db = getDB();

  const existingEntry = await db.query.cmsEntryTable.findFirst({
    where: eq(cmsEntryTable.id, id),
  });

  if (!existingEntry) {
    throw new Error(`Entry with id "${id}" not found`);
  }

  const collectionSlug = existingEntry.collection;
  const slug = existingEntry.slug;

  await db.delete(cmsEntryMediaTable).where(eq(cmsEntryMediaTable.entryId, id));

  await db.delete(cmsEntryTable).where(eq(cmsEntryTable.id, id));

  await invalidateCmsEntryCache({ collectionSlug, slug });
}

// Tag Management Functions

export const getCmsTags = cache(async () => {
  const db = getDB();
  return await db.select().from(cmsTagTable).orderBy(desc(cmsTagTable.createdAt));
});

export const getCmsTagById = cache(async (id: string) => {
  const db = getDB();
  return await db.query.cmsTagTable.findFirst({
    where: eq(cmsTagTable.id, id),
  });
});

export async function createCmsTag({
  name,
  slug,
  description,
  color,
  createdBy,
}: {
  name: string;
  slug: string;
  description?: string;
  color?: string;
  createdBy: string;
}) {
  const db = getDB();

  const existingTag = await db.query.cmsTagTable.findFirst({
    where: eq(cmsTagTable.slug, slug),
  });

  if (existingTag) {
    throw new Error(`Tag with slug "${slug}" already exists`);
  }

  const [newTag] = await db.insert(cmsTagTable).values({
    name,
    slug,
    description,
    color,
    createdBy,
  }).returning();

  return newTag;
}

export async function updateCmsTag({
  id,
  name,
  slug,
  description,
  color,
}: {
  id: string;
  name?: string;
  slug?: string;
  description?: string;
  color?: string;
}) {
  const db = getDB();

  const existingTag = await db.query.cmsTagTable.findFirst({
    where: eq(cmsTagTable.id, id),
  });

  if (!existingTag) {
    throw new Error(`Tag with id "${id}" not found`);
  }

  if (slug && slug !== existingTag.slug) {
    const conflictingTag = await db.query.cmsTagTable.findFirst({
      where: eq(cmsTagTable.slug, slug),
    });

    if (conflictingTag) {
      throw new Error(`Tag with slug "${slug}" already exists`);
    }
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

  return updatedTag;
}

export async function deleteCmsTag(id: string) {
  const db = getDB();

  await db.delete(cmsTagTable).where(eq(cmsTagTable.id, id));
}
