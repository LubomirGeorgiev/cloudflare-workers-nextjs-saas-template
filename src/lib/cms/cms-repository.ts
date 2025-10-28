"use server";

import { cache } from "react";
import { eq, and, desc, asc } from "drizzle-orm";

import { getDB } from "@/db"
import { cmsConfig } from "@/../cms.config";
import { cmsEntryTable, cmsEntryMediaTable, CMS_ENTRY_STATUS, type CmsEntry } from "@/db/schema";

// TODO Implement KV cache for CMS entries
// TODO Automatically add cms entries to the sitemap and also add the option to hide certain entries from the sitemap

// Extend CMS_ENTRY_STATUS with 'all' option for queries
export type CmsEntryStatus = typeof CMS_ENTRY_STATUS[keyof typeof CMS_ENTRY_STATUS] | 'all';

/**
 * Options for including related data in CMS queries
 */
export type CmsIncludeRelations = {
  /**
   * Include the user who created the entry
   */
  createdByUser?: boolean;
  /**
   * Include associated media files
   */
  media?: boolean;
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

  return relations;
}

type GetCmsCollectionParams<T extends keyof typeof cmsConfig.collections> = {
  collectionSlug: T;
  /**
   * Filter by status. Defaults to 'published' only.
   * Pass 'all' to get entries with any status.
   */
  status?: CmsEntryStatus;
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

  // Get the collection config
  const collection = cmsConfig.collections[collectionSlug];
  if (!collection) {
    throw new Error(`Collection "${String(collectionSlug)}" not found in CMS config`);
  }

  // Build the where clause
  const whereConditions = [
    eq(cmsEntryTable.collection, collection.slug),
  ];

  // Add status filter if not 'all'
  if (status !== 'all') {
    whereConditions.push(eq(cmsEntryTable.status, status));
  }

  // Build the query with optional relations
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

type GetCmsEntryParams<T extends keyof typeof cmsConfig.collections> = {
  collectionSlug: T;
  slug: string;
  /**
   * Filter by status. Defaults to 'published' only.
   */
  status?: CmsEntryStatus;
  /**
   * Include relations in the query
   */
  includeRelations?: CmsIncludeRelations;
};

/**
 * Get a single CMS entry by collection and slug (for detail pages)
 *
 * @example
 * // Get a specific blog post by slug
 * const post = await getCmsEntry({
 *   collectionSlug: 'blog',
 *   slug: 'my-first-post',
 *   includeRelations: { createdByUser: true, media: true }
 * });
 */
export const getCmsEntry = cache(async <T extends keyof typeof cmsConfig.collections>({
  collectionSlug,
  slug,
  status = CMS_ENTRY_STATUS.PUBLISHED,
  includeRelations,
}: GetCmsEntryParams<T>): Promise<GetCmsCollectionResult | null> => {
  const db = getDB();

  // Get the collection config
  const collection = cmsConfig.collections[collectionSlug];
  if (!collection) {
    throw new Error(`Collection "${String(collectionSlug)}" not found in CMS config`);
  }

  // Build the where clause
  const whereConditions = [
    eq(cmsEntryTable.collection, collection.slug),
    eq(cmsEntryTable.slug, slug),
  ];

  // Add status filter if not 'all'
  if (status !== 'all') {
    whereConditions.push(eq(cmsEntryTable.status, status));
  }

  // Build the query with optional relations
  const entry = await db.query.cmsEntryTable.findFirst({
    where: and(...whereConditions),
    with: buildCmsRelationsQuery(includeRelations),
  });

  return entry as GetCmsCollectionResult | null;
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

type CreateCmsEntryParams<T extends keyof typeof cmsConfig.collections> = {
  collectionSlug: T;
  slug: string;
  title: string;
  /**
   * The main content of the entry (e.g., rich text, markdown, etc.)
   */
  content: unknown;
  /**
   * Custom fields specific to the collection (e.g., excerpt, author, tags, etc.)
   */
  fields: unknown;
  status?: typeof CMS_ENTRY_STATUS[keyof typeof CMS_ENTRY_STATUS];
  createdBy: string;
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
  status = CMS_ENTRY_STATUS.DRAFT,
  createdBy,
}: CreateCmsEntryParams<T>): Promise<CmsEntry> {
  const db = getDB();

  // Get the collection config
  const collection = cmsConfig.collections[collectionSlug];
  if (!collection) {
    throw new Error(`Collection "${String(collectionSlug)}" not found in CMS config`);
  }

  // Check if slug already exists in this collection
  const existingEntry = await db.query.cmsEntryTable.findFirst({
    where: and(
      eq(cmsEntryTable.collection, collection.slug),
      eq(cmsEntryTable.slug, slug)
    ),
  });

  if (existingEntry) {
    throw new Error(`Entry with slug "${slug}" already exists in collection "${collection.slug}"`);
  }

  // Insert the new entry
  const [newEntry] = await db.insert(cmsEntryTable).values({
    collection: collection.slug,
    slug,
    title,
    content,
    fields,
    status,
    createdBy,
  }).returning();

  return newEntry;
}

type UpdateCmsEntryParams = {
  id: string;
  slug?: string;
  title?: string;
  /**
   * The main content of the entry (e.g., rich text, markdown, etc.)
   */
  content?: unknown;
  /**
   * Custom fields specific to the collection (e.g., excerpt, author, tags, etc.)
   */
  fields?: unknown;
  status?: typeof CMS_ENTRY_STATUS[keyof typeof CMS_ENTRY_STATUS];
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
  status,
}: UpdateCmsEntryParams): Promise<CmsEntry | null> {
  const db = getDB();

  // Check if entry exists
  const existingEntry = await db.query.cmsEntryTable.findFirst({
    where: eq(cmsEntryTable.id, id),
  });

  if (!existingEntry) {
    throw new Error(`Entry with id "${id}" not found`);
  }

  // If slug is being changed, check for conflicts
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

  // Update the entry
  const [updatedEntry] = await db
    .update(cmsEntryTable)
    .set({
      slug: slug,
      title: title,
      content: content,
      fields: fields,
      status: status,
    })
    .where(eq(cmsEntryTable.id, id))
    .returning();

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

  // Check if entry exists
  const existingEntry = await db.query.cmsEntryTable.findFirst({
    where: eq(cmsEntryTable.id, id),
  });

  if (!existingEntry) {
    throw new Error(`Entry with id "${id}" not found`);
  }

  // Delete associated media relations first
  await db.delete(cmsEntryMediaTable).where(eq(cmsEntryMediaTable.entryId, id));

  // Delete the entry
  await db.delete(cmsEntryTable).where(eq(cmsEntryTable.id, id));
}
