import "server-only";

import { cache } from "react";
import { eq, and, desc, count, sql } from "drizzle-orm";
import type { JSONContent } from "@tiptap/core";
import { z } from "zod";

import { getDB } from "@/db"
import { cmsConfig, CollectionsUnion } from "@/../cms.config";
import { cmsEntryTable, cmsEntryMediaTable, cmsTagTable, cmsEntryTagTable, cmsEntryVersionTable, type CmsEntry, type CmsTag, type CmsEntryVersion } from "@/db/schema";
import { CMS_ENTRY_STATUS } from "@/app/enums";
import { CMS_SEO_DESCRIPTION_MAX_LENGTH } from "@/constants";
import { withKVCache, CACHE_KEYS } from "@/utils/with-kv-cache";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { generateSeoDescription } from "@/lib/cms/generate-seo-description";
import { syncEntryMediaRelationships } from "@/lib/cms/media-tracking";
import { getCmsImagePublicUrl } from "@/lib/cms/cms-images";
import { getCmsCollectionNavigationKey } from "@/lib/cms/cms-navigation-config";
import { cmsEntryStatusSchema } from "@/schemas/cms-entry.schema";
import {
  CMS_STATUS_FILTER_ALL,
  cmsStatusFilterTuple,
  type CmsEntryStatus,
  type CmsStatusFilter,
} from "@/types/cms";

// TODO Check if the tiptap editor supports warning and error blocks
// TODO Add blog table of contents
// TODO Add open graph image generation
// TODO Add CMS documentation example with drag-and-drop navigation
// TODO Automatically add cms entries to the sitemap and also add the option to hide certain entries from the sitemap
// TODO Explain how to use the CMS in the README.md file
// TODO Uploading images from the editor and a dedicated media collection admin page
// TODO Replace Radix with BaseUI

// Zod Schemas for validation
// TODO We already define those for the front-end in cms-entry.schema.ts. We should use them here too for the server actions.
const cmsEntryStatusOrAllSchema = z.enum(cmsStatusFilterTuple);

const cmsIncludeRelationsSchema = z.object({
  createdByUser: z.boolean().optional(),
  media: z.boolean().optional(),
  tags: z.boolean().optional(),
}).optional();

const getCmsCollectionParamsSchema = z.object({
  collectionSlug: z.string(),
  status: cmsEntryStatusOrAllSchema.optional().default(CMS_ENTRY_STATUS.PUBLISHED),
  includeRelations: cmsIncludeRelationsSchema,
  limit: z.number().positive().optional(),
  offset: z.number().nonnegative().optional(),
});

const getCmsCollectionCountParamsSchema = z.object({
  collectionSlug: z.string(),
  status: cmsEntryStatusOrAllSchema.optional().default(CMS_ENTRY_STATUS.PUBLISHED),
});

const getCmsEntryByIdParamsSchema = z.object({
  id: z.string().min(1),
  includeRelations: cmsIncludeRelationsSchema,
});

const getCmsEntryBySlugParamsSchema = z.object({
  collectionSlug: z.string(),
  slug: z.string().min(1),
  status: cmsEntryStatusOrAllSchema.optional().default(CMS_ENTRY_STATUS.PUBLISHED),
  includeRelations: cmsIncludeRelationsSchema,
});

const cmsEntryBaseSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  content: z.any(), // JSONContent - complex type, validated separately
  fields: z.unknown(),
  seoDescription: z.string().max(CMS_SEO_DESCRIPTION_MAX_LENGTH).optional(),
  status: cmsEntryStatusSchema.optional(),
  publishedAt: z.date().optional(),
  tagIds: z.array(z.string()).optional(),
  featuredImageId: z.string().nullable().optional(),
});

// Helper function to add status/publishedAt validation and transformation
function withStatusPublishedAtValidation<T extends z.ZodTypeAny>(schema: T) {
  return schema.refine(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (data: any) => {
      // If publishedAt is in the future, status must be scheduled
      if (data.publishedAt && data.publishedAt instanceof Date && data.publishedAt > new Date()) {
        return data.status === CMS_ENTRY_STATUS.SCHEDULED;
      }
      return true;
    },
    {
      message: "Status must be 'scheduled' when publishedAt is set to a future date",
      path: ['status'],
    }
  ).refine(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (data: any) => {
      // If status is scheduled, publishedAt must be provided and in the future
      if (data.status === CMS_ENTRY_STATUS.SCHEDULED) {
        if (!data.publishedAt) {
          return false;
        }
        return data.publishedAt instanceof Date && data.publishedAt > new Date();
      }
      return true;
    },
    {
      message: "publishedAt is required and must be in the future for scheduled entries",
      path: ['publishedAt'],
    }
  ).transform(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (data: any) => {
      // If status is published and no publishedAt, set it to now
      if (data.status === CMS_ENTRY_STATUS.PUBLISHED && !data.publishedAt) {
        return { ...data, publishedAt: new Date() };
      }
      return data;
    }
  );
}

const createCmsEntryParamsSchema = withStatusPublishedAtValidation(
  cmsEntryBaseSchema.extend({
    collectionSlug: z.string(),
    status: cmsEntryStatusSchema.optional().default(CMS_ENTRY_STATUS.DRAFT),
    createdBy: z.string().min(1),
  })
);

const updateCmsEntryParamsSchema = withStatusPublishedAtValidation(
  cmsEntryBaseSchema.partial().extend({
    id: z.string().min(1),
  })
);

const deleteCmsEntryParamsSchema = z.object({
  id: z.string().min(1),
});

const getCmsTagByIdParamsSchema = z.string().min(1);

const getCmsEntriesByTagIdParamsSchema = z.object({
  tagId: z.string().min(1),
  status: cmsEntryStatusOrAllSchema.optional().default(CMS_STATUS_FILTER_ALL),
});

const createCmsTagParamsSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().optional(),
  color: z.string().optional(),
  createdBy: z.string().min(1),
});

const updateCmsTagParamsSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  slug: z.string().min(1).optional(),
  description: z.string().optional(),
  color: z.string().optional(),
});

const deleteCmsTagParamsSchema = z.string().min(1);

const getCmsEntryVersionsParamsSchema = z.string().min(1);

const deleteCmsEntryVersionParamsSchema = z.object({
  entryId: z.string().min(1),
  versionId: z.string().min(1),
});

const revertCmsEntryToVersionParamsSchema = z.object({
  entryId: z.string().min(1),
  versionId: z.string().min(1),
});

function getCmsEntryCacheKey({
  collectionSlug,
  slug,
  status,
}: {
  collectionSlug: CollectionsUnion;
  slug: string;
  status?: CmsStatusFilter;
}): string {
  const base = `${CACHE_KEYS.CMS_ENTRY}:${collectionSlug}:${slug}`;
  return status ? `${base}:${status}` : base;
}

function getCmsCollectionCacheKey({
  collectionSlug,
  status,
  includeRelations,
  limit,
  offset,
}: {
  collectionSlug?: CollectionsUnion;
  status?: CmsStatusFilter;
  includeRelations?: CmsIncludeRelations;
  limit?: number;
  offset?: number;
}): string {
  // If no collectionSlug provided, return base prefix for all collections
  if (!collectionSlug) {
    return `${CACHE_KEYS.CMS_COLLECTION}:`;
  }

  // Base key with collection slug
  const base = `${CACHE_KEYS.CMS_COLLECTION}:${collectionSlug}:`;

  // If only collectionSlug is provided, return prefix for invalidation
  if (status === undefined && includeRelations === undefined && limit === undefined && offset === undefined) {
    return base;
  }

  // Full key with all parameters for specific cache lookup
  return `${base}${status}:${JSON.stringify(includeRelations)}:${limit}:${offset}`;
}

function getCmsCollectionCountCacheKey({
  collectionSlug,
  status,
}: {
  collectionSlug?: CollectionsUnion;
  status?: CmsStatusFilter;
}): string {
  if (!collectionSlug) {
    return `${CACHE_KEYS.CMS_COLLECTION}:count:`;
  }

  if (status === undefined) {
    return `${CACHE_KEYS.CMS_COLLECTION}:count:${collectionSlug}:`;
  }

  return `${CACHE_KEYS.CMS_COLLECTION}:count:${collectionSlug}:${status}`;
}

async function invalidateCacheByPrefix(prefix: string): Promise<void> {
  const { env } = await getCloudflareContext({ async: true });
  const kv = env.NEXT_INC_CACHE_KV;

  if (!kv) {
    return;
  }

  let cursor: string | undefined;
  const keysToDelete: string[] = [];

  do {
    const result = await kv.list({ prefix, cursor });
    keysToDelete.push(...result.keys.map((key) => key.name));
    cursor = !result.list_complete && "cursor" in result ? result.cursor : undefined;
  } while (cursor);

  if (keysToDelete.length > 0) {
    await Promise.all(keysToDelete.map((key) => kv.delete(key)));
  }
}

export async function invalidateCmsEntryCache({
  collectionSlug,
  slug,
}: {
  collectionSlug: CollectionsUnion;
  slug: string;
}): Promise<void> {
  const prefix = getCmsEntryCacheKey({ collectionSlug, slug });
  await invalidateCacheByPrefix(prefix);
}

/**
 * Invalidate all collection cache entries for a given collection
 * Uses kv.list to find and delete all cache keys matching the collection
 */
export async function invalidateCmsCollectionCache({
  collectionSlug,
}: {
  collectionSlug: CollectionsUnion;
}): Promise<void> {
  const prefix = getCmsCollectionCacheKey({ collectionSlug });
  await invalidateCacheByPrefix(prefix);
}

export async function invalidateCmsCollectionCountCache({
  collectionSlug,
}: {
  collectionSlug: CollectionsUnion;
}): Promise<void> {
  const prefix = getCmsCollectionCountCacheKey({ collectionSlug });
  await invalidateCacheByPrefix(prefix);
}

async function invalidateCmsNavigationCachesForCollection({
  collectionSlug,
}: {
  collectionSlug: CollectionsUnion;
}): Promise<void> {
  const navigationKey = getCmsCollectionNavigationKey(collectionSlug);

  if (!navigationKey) {
    return;
  }

  await Promise.all([
    invalidateCacheByPrefix(`${CACHE_KEYS.CMS_NAVIGATION}:${navigationKey}:`),
    invalidateCacheByPrefix(`${CACHE_KEYS.CMS_REDIRECT}:${navigationKey}:`),
  ]);
}

async function invalidateSitemapCache(): Promise<void> {
  const { env } = await getCloudflareContext({ async: true });
  const kv = env.NEXT_INC_CACHE_KV;

  if (!kv) {
    return;
  }

  await kv.delete(CACHE_KEYS.SITEMAP);
}

/**
 * Helper function to invalidate both entry-specific cache and collection listings
 * This is a common pattern used after creating, updating, or deleting CMS entries
 */
async function invalidateEntryAndCollection({
  collectionSlug,
  slug,
}: {
  collectionSlug: CollectionsUnion;
  slug: string;
}): Promise<void> {
  await Promise.all([
    invalidateCmsEntryCache({ collectionSlug, slug }),
    invalidateCmsCollectionCache({ collectionSlug }),
    invalidateCmsCollectionCountCache({ collectionSlug }),
    invalidateCmsNavigationCachesForCollection({ collectionSlug }),
    invalidateSitemapCache(),
  ]);
}

/**
 * Invalidate all collection caches across all collections
 * Used when changes affect multiple collections (e.g., tag updates)
 */
async function invalidateAllCmsCollectionCaches(): Promise<void> {
  await Promise.all([
    invalidateCacheByPrefix(getCmsCollectionCacheKey({})),
    invalidateCacheByPrefix(getCmsCollectionCountCacheKey({})),
    invalidateCacheByPrefix(`${CACHE_KEYS.CMS_NAVIGATION}:`),
    invalidateCacheByPrefix(`${CACHE_KEYS.CMS_REDIRECT}:`),
    invalidateSitemapCache(),
  ]);
}

/**
 * Helper function that checks if a scheduled entry should be auto-published
 * and performs the status update if the publishedAt time has passed
 */
async function autoPublishScheduledEntry<T extends CmsEntry>(entry: T): Promise<T> {
  if (entry.status === CMS_ENTRY_STATUS.SCHEDULED &&
      entry.publishedAt &&
      entry.publishedAt <= new Date()) {
    // Update status to published
    const db = getDB();
    const [updated] = await db
      .update(cmsEntryTable)
      .set({ status: CMS_ENTRY_STATUS.PUBLISHED })
      .where(eq(cmsEntryTable.id, entry.id))
      .returning();

    // Invalidate cache for both the specific entry and all collection listings
    await invalidateEntryAndCollection({
      collectionSlug: entry.collection,
      slug: entry.slug
    });

    // Merge the updated status back into the original entry object to preserve relations
    return { ...entry, status: updated.status } as T;
  }
  return entry;
}

/**
 * Helper function to build status filter conditions
 * When querying for published entries, also includes scheduled entries so they can be auto-published at runtime
 */
function buildStatusWhereCondition(status: CmsStatusFilter) {
  if (status === CMS_STATUS_FILTER_ALL) {
    return undefined;
  }

  if (status === CMS_ENTRY_STATUS.PUBLISHED) {
    // Include both published and scheduled entries so we can auto-publish scheduled ones
    return sql`${cmsEntryTable.status} IN (${CMS_ENTRY_STATUS.PUBLISHED}, ${CMS_ENTRY_STATUS.SCHEDULED})`;
  }

  return eq(cmsEntryTable.status, status);
}

/**
 * Helper function to validate entry fields using collection's Zod schema
 */
function validateEntryFields(
  fields: unknown,
  collection: typeof cmsConfig.collections[keyof typeof cmsConfig.collections]
): unknown {
  if (!("fieldsSchema" in collection) || !collection.fieldsSchema) {
    return fields;
  }

  const parseResult = collection.fieldsSchema.safeParse(fields);
  if (!parseResult.success) {
    throw new Error(`Invalid fields: ${parseResult.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`);
  }

  return parseResult.data;
}

/**
 * Helper function to validate SEO description length
 */
function validateSeoDescription(seoDescription: string | null | undefined): void {
  if (seoDescription && seoDescription.length > CMS_SEO_DESCRIPTION_MAX_LENGTH) {
    throw new Error(`SEO description exceeds maximum length of ${CMS_SEO_DESCRIPTION_MAX_LENGTH} characters (got ${seoDescription.length})`);
  }
}

/**
 * Helper function to handle publishedAt logic based on entry status
 */
function handlePublishedAt(
  status: CmsEntryStatus,
  publishedAt: Date | undefined,
  existingPublishedAt?: Date | null
): Date | undefined {
  if (status === CMS_ENTRY_STATUS.PUBLISHED && !publishedAt && !existingPublishedAt) {
    // Auto-set publishedAt to now for published entries
    return new Date();
  }

  if (status === CMS_ENTRY_STATUS.SCHEDULED) {
    // Validate that scheduled entries have a future publishedAt date
    if (!publishedAt) {
      throw new Error('publishedAt is required for scheduled entries');
    }
    if (publishedAt <= new Date()) {
      throw new Error('publishedAt must be in the future for scheduled entries');
    }
  }

  return publishedAt;
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

  // Always include featured image if present
  relations.featuredImage = true;

  return relations;
}

type GetCmsCollectionParams<T extends CollectionsUnion> = Omit<z.infer<typeof getCmsCollectionParamsSchema>, 'collectionSlug' | 'status'> & {
  collectionSlug: T;
  status?: CmsStatusFilter;
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
  featuredImage?: {
    id: string;
    fileName: string;
    mimeType: string;
    sizeInBytes: number;
    bucketKey: string;
    width: number | null;
    height: number | null;
    alt: string | null;
  } | null;
  featuredImageUrl?: string | null;
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
export const getCmsCollection = cache(async <T extends keyof typeof cmsConfig.collections>(
  params: GetCmsCollectionParams<T>
): Promise<GetCmsCollectionResult[]> => {
  const validated = getCmsCollectionParamsSchema.parse(params);
  const { collectionSlug, status, includeRelations, limit, offset } = validated;

  // Generate a unique cache key based on the query parameters
  const cacheKey = getCmsCollectionCacheKey({
    collectionSlug: collectionSlug as CollectionsUnion,
    status,
    includeRelations,
    limit,
    offset,
  });

  // Fetch entries from cache or DB (includes scheduled entries)
  const cachedEntries = await withKVCache(
    async () => {
      const db = getDB();

      const collection = cmsConfig.collections[collectionSlug as CollectionsUnion];
      if (!collection) {
        throw new Error(`Collection "${String(collectionSlug)}" not found in CMS config`);
      }

      const whereConditions = [
        eq(cmsEntryTable.collection, collection.slug as CollectionsUnion),
      ];

      const statusCondition = buildStatusWhereCondition(status);
      if (statusCondition) {
        whereConditions.push(statusCondition);
      }

      const entries = await db.query.cmsEntryTable.findMany({
        where: and(...whereConditions),
        orderBy: [desc(cmsEntryTable.createdAt)],
        limit: limit,
        offset: offset,
        with: buildCmsRelationsQuery(includeRelations),
      });

      // Generate featured image URLs for all entries
      const results = entries.map(entry => {
        const result = entry as GetCmsCollectionResult;
        if (result.featuredImage?.bucketKey) {
          result.featuredImageUrl = getCmsImagePublicUrl(result.featuredImage.bucketKey);
        }
        return result;
      });

      return results;
    },
    {
      key: cacheKey,
      ttl: "8 hours",
    }
  );

  // Auto-publish any scheduled entries that are due (runs on every request)
  let processedEntries = await Promise.all(cachedEntries.map(entry => autoPublishScheduledEntry(entry)));

  // Filter out entries that are still scheduled (not yet ready to be published)
  // This ensures scheduled entries with future publishedAt don't appear in public queries
  if (status === CMS_ENTRY_STATUS.PUBLISHED) {
    processedEntries = processedEntries.filter(entry => {
      // Include published entries and scheduled entries that were just auto-published
      return entry.status === CMS_ENTRY_STATUS.PUBLISHED;
    });
  }

  return processedEntries;
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
export const getCmsCollectionCount = cache(async <T extends keyof typeof cmsConfig.collections>(
  params: z.infer<typeof getCmsCollectionCountParamsSchema> & { collectionSlug: T }
): Promise<number> => {
  const validated = getCmsCollectionCountParamsSchema.parse(params);
  const { collectionSlug, status } = validated;

  const collection = cmsConfig.collections[collectionSlug as CollectionsUnion];
  if (!collection) {
    throw new Error(`Collection "${String(collectionSlug)}" not found in CMS config`);
  }

  const cacheKey = getCmsCollectionCountCacheKey({
    collectionSlug: collection.slug as CollectionsUnion,
    status,
  });

  return withKVCache(async () => {
    const db = getDB();
    const whereConditions = [
      eq(cmsEntryTable.collection, collection.slug as CollectionsUnion),
    ];

    const statusCondition = buildStatusWhereCondition(status);
    if (statusCondition) {
      whereConditions.push(statusCondition);
    }

    const result = await db
      .select({ count: count() })
      .from(cmsEntryTable)
      .where(and(...whereConditions));

    return result[0]?.count ?? 0;
  }, {
    key: cacheKey,
    ttl: "8 hours",
  });
});


type GetCmsEntryByIdParams = z.infer<typeof getCmsEntryByIdParamsSchema>;

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
export const getCmsEntryById = cache(async (params: GetCmsEntryByIdParams): Promise<GetCmsCollectionResult | null> => {
  const validated = getCmsEntryByIdParamsSchema.parse(params);
  const { id, includeRelations } = validated;

  const db = getDB();

  const entry = await db.query.cmsEntryTable.findFirst({
    where: eq(cmsEntryTable.id, id),
    with: buildCmsRelationsQuery(includeRelations),
  });

  if (!entry) {
    return null;
  }

  // Generate featured image URL if featured image exists
  const result = entry as GetCmsCollectionResult;
  if (result.featuredImage?.bucketKey) {
    result.featuredImageUrl = getCmsImagePublicUrl(result.featuredImage.bucketKey);
  }

  return result;
});

type GetCmsEntryBySlugParams<T extends keyof typeof cmsConfig.collections> = Omit<z.infer<typeof getCmsEntryBySlugParamsSchema>, 'collectionSlug' | 'status'> & {
  collectionSlug: T;
  status?: CmsStatusFilter;
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
export async function getCmsEntryBySlug<T extends keyof typeof cmsConfig.collections>(
  params: GetCmsEntryBySlugParams<T>
): Promise<GetCmsEntryBySlugResult | null> {
  const validated = getCmsEntryBySlugParamsSchema.parse(params);
  const { collectionSlug, slug, status, includeRelations } = validated;

  const collection = cmsConfig.collections[collectionSlug as T];
  if (!collection) {
    throw new Error(`Collection "${String(collectionSlug)}" not found in CMS config`);
  }

  const cacheKey = getCmsEntryCacheKey({
    collectionSlug: collection.slug as CollectionsUnion,
    slug,
    status,
  });

  // Fetch entry from cache or DB (includes scheduled entries)
  const cachedEntry = await withKVCache(
    async () => {
      const db = getDB();

      const whereConditions = [
        eq(cmsEntryTable.collection, collection.slug as CollectionsUnion),
        eq(cmsEntryTable.slug, slug),
      ];

      const statusCondition = buildStatusWhereCondition(status);
      if (statusCondition) {
        whereConditions.push(statusCondition);
      }

      const entry = await db.query.cmsEntryTable.findFirst({
        where: and(...whereConditions),
        with: buildCmsRelationsQuery(includeRelations),
      });

      if (!entry) {
        return null;
      }

      // Generate featured image URL if featured image exists
      const result = entry as GetCmsCollectionResult;
      if (result.featuredImage?.bucketKey) {
        result.featuredImageUrl = getCmsImagePublicUrl(result.featuredImage.bucketKey);
      }

      return result;
    },
    {
      key: cacheKey,
      ttl: '7 days',
    }
  );

  // If entry not found, return null
  if (!cachedEntry) {
    return null;
  }

  // Auto-publish if the entry is scheduled and the time has come (runs on every request)
  const processedEntry = await autoPublishScheduledEntry(cachedEntry);

  // If entry is still scheduled (publishedAt in future), return null for public access
  // This creates a 404 behavior for entries not yet published
  if (status === CMS_ENTRY_STATUS.PUBLISHED && processedEntry.status === CMS_ENTRY_STATUS.SCHEDULED) {
    return null;
  }

  return processedEntry;
}

type CreateCmsEntryParams<T extends keyof typeof cmsConfig.collections> = z.infer<typeof createCmsEntryParamsSchema> & {
  collectionSlug: T;
  content: JSONContent;
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
export async function createCmsEntry<T extends keyof typeof cmsConfig.collections>(
  params: CreateCmsEntryParams<T>
): Promise<CmsEntry> {
  const validated = createCmsEntryParamsSchema.parse(params);
  const { collectionSlug, slug, title, content, fields, seoDescription, status, publishedAt, createdBy, tagIds, featuredImageId } = validated;

  const db = getDB();

  const collection = cmsConfig.collections[collectionSlug as T];
  if (!collection) {
    throw new Error(`Collection "${String(collectionSlug)}" not found in CMS config`);
  }

  // Validate fields using Zod schema if provided
  const validatedFields = validateEntryFields(fields, collection);

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
  validateSeoDescription(finalSeoDescription);

  const existingEntry = await db.query.cmsEntryTable.findFirst({
    where: and(
      eq(cmsEntryTable.collection, collection.slug as CollectionsUnion),
      eq(cmsEntryTable.slug, slug)
    ),
  });

  if (existingEntry) {
    throw new Error(`Entry with slug "${slug}" already exists in collection "${collection.slug}"`);
  }

  // Handle publishedAt based on status
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

  // Sync media relationships based on content and featured image
  await syncEntryMediaRelationships({
    entryId: newEntry.id,
    content,
    featuredImageId,
  });

  // Skip creating initial version to save space
  // The version will be created automatically on first update
  // This avoids duplicating data between cms_entry and cms_entry_version

  // Invalidate collection cache and sitemap since we added a new entry
  await Promise.all([
    invalidateCmsEntryCache({
      collectionSlug: collection.slug as CollectionsUnion,
      slug,
    }),
    invalidateCmsCollectionCache({
      collectionSlug: collection.slug as CollectionsUnion
    }),
    invalidateCmsCollectionCountCache({
      collectionSlug: collection.slug as CollectionsUnion,
    }),
    invalidateCmsNavigationCachesForCollection({
      collectionSlug: collection.slug as CollectionsUnion,
    }),
    invalidateSitemapCache(),
  ]);

  return newEntry;
}

type UpdateCmsEntryParams = z.infer<typeof updateCmsEntryParamsSchema> & {
  content?: JSONContent;
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
export async function updateCmsEntry(params: UpdateCmsEntryParams): Promise<CmsEntry | null> {
  const validated = updateCmsEntryParamsSchema.parse(params);
  const { id, slug, title, content, fields, seoDescription, status, publishedAt, tagIds, featuredImageId } = validated;

  const db = getDB();

  const existingEntry = await db.query.cmsEntryTable.findFirst({
    where: eq(cmsEntryTable.id, id),
  });

  if (!existingEntry) {
    throw new Error(`Entry with id "${id}" not found`);
  }

  const collection = cmsConfig.collections[existingEntry.collection as CollectionsUnion];
  if (!collection) {
    throw new Error(`Collection "${existingEntry.collection}" not found in CMS config`);
  }

  // Validate fields using Zod schema if provided
  let validatedFields: unknown = undefined;
  if (fields !== undefined) {
    validatedFields = validateEntryFields(fields, collection);
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
  }

  // Validate SEO description length
  validateSeoDescription(finalSeoDescription);

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

  // Handle publishedAt based on status changes
  const finalStatus = status ?? existingEntry.status;
  const finalPublishedAt = publishedAt !== undefined
    ? handlePublishedAt(finalStatus, publishedAt, existingEntry.publishedAt)
    : undefined;

  // Build update object with only fields that were explicitly provided
  // This automatically filters out undefined values so we only update what was provided
  const updateData = {
    slug,
    title,
    content,
    fields: validatedFields,
    seoDescription: finalSeoDescription,
    status,
    publishedAt: finalPublishedAt,
    featuredImageId,
  };

  // Remove undefined values to avoid updating fields that weren't provided
  const filteredUpdateData = Object.fromEntries(
    Object.entries(updateData).filter(([_, value]) => value !== undefined)
  );

  const [updatedEntry] = await db
    .update(cmsEntryTable)
    .set(filteredUpdateData)
    .where(eq(cmsEntryTable.id, id))
    .returning();

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

  // Sync media relationships if content or featured image changed
  if (content !== undefined || featuredImageId !== undefined) {
    await syncEntryMediaRelationships({
      entryId: id,
      content: content ?? existingEntry.content,
      featuredImageId: featuredImageId !== undefined ? featuredImageId : existingEntry.featuredImageId,
    });
  }

  const latestVersion = await db.query.cmsEntryVersionTable.findFirst({
    where: eq(cmsEntryVersionTable.entryId, id),
    orderBy: [desc(cmsEntryVersionTable.versionNumber)],
  });

  // If no versions exist, create version 1 as a snapshot of the current state (before update)
  // This ensures version consistency even though we skipped the initial version on creation
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

  // Manually serialize JSON fields for D1 compatibility
  const versionContent = content ?? existingEntry.content;
  const versionFields = validatedFields ?? existingEntry.fields;

  await db.insert(cmsEntryVersionTable).values({
    entryId: id,
    versionNumber: nextVersionNumber,
    title: title ?? existingEntry.title,
    content: (versionContent) as JSONContent,
    fields: versionFields,
    slug: slug ?? existingEntry.slug,
    seoDescription: finalSeoDescription ?? existingEntry.seoDescription,
    status: status ?? existingEntry.status,
    featuredImageId: featuredImageId !== undefined ? featuredImageId : existingEntry.featuredImageId,
    createdBy: existingEntry.createdBy, // We might want to track who updated it, but schema currently uses createdBy. Assuming the user updating is the one creating the version.
  });

  const oldSlug = existingEntry.slug;
  const newSlug = slug ?? oldSlug;
  const collectionSlug = existingEntry.collection;

  const slugsToInvalidate = new Set([oldSlug, newSlug]);

  // Invalidate both entry-specific caches and collection listings
  await Promise.all([
    ...Array.from(slugsToInvalidate).map(slugToInvalidate =>
      invalidateCmsEntryCache({ collectionSlug, slug: slugToInvalidate })
    ),
    invalidateCmsCollectionCache({ collectionSlug }),
    invalidateCmsCollectionCountCache({ collectionSlug }),
    invalidateCmsNavigationCachesForCollection({ collectionSlug }),
    invalidateSitemapCache(),
  ]);

  return updatedEntry || null;
}

type DeleteCmsEntryParams = z.infer<typeof deleteCmsEntryParamsSchema>;

/**
 * Delete a CMS entry and its associated media relations
 *
 * Note: This does not delete the actual media files, only the associations.
 *
 * @example
 * // Delete a blog post
 * await deleteCmsEntry({ id: 'cms_ent_abc123' });
 */
export async function deleteCmsEntry(params: DeleteCmsEntryParams): Promise<void> {
  const validated = deleteCmsEntryParamsSchema.parse(params);
  const { id } = validated;

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

  // Invalidate both entry-specific cache and collection listings
  await invalidateEntryAndCollection({ collectionSlug, slug });
}

// Tag Management Functions

export const getCmsTags = cache(async () => {
  const db = getDB();

  const tags = await db
    .select({
      id: cmsTagTable.id,
      name: cmsTagTable.name,
      slug: cmsTagTable.slug,
      description: cmsTagTable.description,
      color: cmsTagTable.color,
      createdBy: cmsTagTable.createdBy,
      createdAt: cmsTagTable.createdAt,
      updatedAt: cmsTagTable.updatedAt,
      updateCounter: cmsTagTable.updateCounter,
      entryCount: count(cmsEntryTagTable.id),
    })
    .from(cmsTagTable)
    .leftJoin(cmsEntryTagTable, eq(cmsTagTable.id, cmsEntryTagTable.tagId))
    .groupBy(cmsTagTable.id)
    .orderBy(desc(cmsTagTable.createdAt));

  return tags;
});

export const getCmsTagById = cache(async (id: z.infer<typeof getCmsTagByIdParamsSchema>) => {
  const validated = getCmsTagByIdParamsSchema.parse(id);

  const db = getDB();
  return await db.query.cmsTagTable.findFirst({
    where: eq(cmsTagTable.id, validated),
  });
});

/**
 * Get all CMS entries that use a specific tag, grouped by collection
 */
export const getCmsEntriesByTagId = cache(async (params: { tagId: string; status?: CmsStatusFilter }) => {
  const validated = getCmsEntriesByTagIdParamsSchema.parse(params);
  const { tagId, status } = validated;

  const db = getDB();

  // Build the where conditions
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

  // Group entries by collection
  const entriesByCollection = entries.reduce((acc, entry) => {
    if (!acc[entry.collection]) {
      acc[entry.collection] = [];
    }
    acc[entry.collection].push(entry);
    return acc;
  }, {} as Record<string, typeof entries>);

  return entriesByCollection;
});

export async function createCmsTag(params: z.infer<typeof createCmsTagParamsSchema>) {
  const validated = createCmsTagParamsSchema.parse(params);
  const { name, slug, description, color, createdBy } = validated;

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

export async function updateCmsTag(params: z.infer<typeof updateCmsTagParamsSchema>) {
  const validated = updateCmsTagParamsSchema.parse(params);
  const { id, name, slug, description, color } = validated;

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

  // Invalidate all collection caches since tag data may be included in collection queries
  await invalidateAllCmsCollectionCaches();

  return updatedTag;
}

export async function deleteCmsTag(id: z.infer<typeof deleteCmsTagParamsSchema>) {
  const validated = deleteCmsTagParamsSchema.parse(id);

  const db = getDB();

  await db.delete(cmsTagTable).where(eq(cmsTagTable.id, validated));

  // Invalidate all collection caches since deleted tag may have been included in collection queries
  await invalidateAllCmsCollectionCaches();
}

// Version Management Functions

export const getCmsEntryVersions = cache(async (entryId: z.infer<typeof getCmsEntryVersionsParamsSchema>): Promise<CmsEntryVersion[]> => {
  const validated = getCmsEntryVersionsParamsSchema.parse(entryId);

  const db = getDB();
  return await db.query.cmsEntryVersionTable.findMany({
    where: eq(cmsEntryVersionTable.entryId, validated),
    orderBy: [desc(cmsEntryVersionTable.versionNumber)],
    with: {
      createdByUser: {
        columns: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          avatar: true,
        },
      },
    },
  });
});

export async function deleteCmsEntryVersion(params: z.infer<typeof deleteCmsEntryVersionParamsSchema>): Promise<void> {
  const validated = deleteCmsEntryVersionParamsSchema.parse(params);
  const { entryId, versionId } = validated;

  const db = getDB();

  // Verify the version exists and belongs to the entry
  const version = await db.query.cmsEntryVersionTable.findFirst({
    where: and(
      eq(cmsEntryVersionTable.id, versionId),
      eq(cmsEntryVersionTable.entryId, entryId)
    ),
  });

  if (!version) {
    throw new Error(`Version "${versionId}" not found for entry "${entryId}"`);
  }

  // Get the latest version to prevent deletion
  const latestVersion = await db.query.cmsEntryVersionTable.findFirst({
    where: eq(cmsEntryVersionTable.entryId, entryId),
    orderBy: [desc(cmsEntryVersionTable.versionNumber)],
  });

  // Prevent deletion of the latest version
  if (latestVersion && latestVersion.id === versionId) {
    throw new Error("Cannot delete the latest version. Please create a new version first.");
  }

  // Prevent deletion if it's the only version
  const versionCount = await db.select({ count: sql<number>`count(*)` })
    .from(cmsEntryVersionTable)
    .where(eq(cmsEntryVersionTable.entryId, entryId));

  if (versionCount[0]?.count <= 1) {
    throw new Error("Cannot delete the only version of an entry.");
  }

  await db.delete(cmsEntryVersionTable)
    .where(and(
      eq(cmsEntryVersionTable.id, versionId),
      eq(cmsEntryVersionTable.entryId, entryId)
    ));
}

export async function revertCmsEntryToVersion(params: z.infer<typeof revertCmsEntryToVersionParamsSchema>): Promise<CmsEntry> {
  const validated = revertCmsEntryToVersionParamsSchema.parse(params);
  const { entryId, versionId } = validated;

  const db = getDB();

  const version = await db.query.cmsEntryVersionTable.findFirst({
    where: and(
      eq(cmsEntryVersionTable.id, versionId),
      eq(cmsEntryVersionTable.entryId, entryId)
    ),
  });

  if (!version) {
    throw new Error(`Version "${versionId}" not found for entry "${entryId}"`);
  }

  // Get current entry state to create a snapshot if needed
  const currentEntry = await db.query.cmsEntryTable.findFirst({
    where: eq(cmsEntryTable.id, entryId),
  });

  if (!currentEntry) {
    throw new Error(`Entry "${entryId}" not found`);
  }

  // Create a new version that is a copy of the reverted version
  // This ensures we keep a linear history even when reverting
  const latestVersion = await db.query.cmsEntryVersionTable.findFirst({
    where: eq(cmsEntryVersionTable.entryId, entryId),
    orderBy: [desc(cmsEntryVersionTable.versionNumber)],
  });

  // If no versions exist (edge case), create version 1 as snapshot of current state
  if (!latestVersion) {
    await db.insert(cmsEntryVersionTable).values({
      entryId: entryId,
      versionNumber: 1,
      title: currentEntry.title,
      content: currentEntry.content as JSONContent,
      fields: currentEntry.fields,
      slug: currentEntry.slug,
      seoDescription: currentEntry.seoDescription,
      status: currentEntry.status,
      featuredImageId: currentEntry.featuredImageId,
      createdBy: currentEntry.createdBy,
    });
  }

  const nextVersionNumber = (latestVersion?.versionNumber ?? 1) + 1;

  // Create the new version snapshot
  await db.insert(cmsEntryVersionTable).values({
    entryId: entryId,
    versionNumber: nextVersionNumber,
    title: version.title,
    content: version.content,
    fields: version.fields,
    slug: version.slug,
    seoDescription: version.seoDescription,
    status: version.status,
    featuredImageId: version.featuredImageId,
    createdBy: version.createdBy, // Or the current user if we had that context here
  });

  // Update the main entry
  const [updatedEntry] = await db
    .update(cmsEntryTable)
    .set({
      title: version.title,
      content: version.content,
      fields: version.fields,
      slug: version.slug,
      seoDescription: version.seoDescription,
      status: version.status,
      featuredImageId: version.featuredImageId,
    })
    .where(eq(cmsEntryTable.id, entryId))
    .returning();

  // Sync media relationships
  await syncEntryMediaRelationships({
    entryId: entryId,
    content: version.content,
    featuredImageId: version.featuredImageId,
  });

  // Invalidate cache for both entry and collection
  const slugsToInvalidate = new Set([currentEntry.slug, updatedEntry.slug]);
  await Promise.all([
    ...Array.from(slugsToInvalidate).map((slugToInvalidate) =>
      invalidateCmsEntryCache({
        collectionSlug: updatedEntry.collection,
        slug: slugToInvalidate,
      })
    ),
    invalidateCmsCollectionCache({ collectionSlug: updatedEntry.collection }),
    invalidateCmsCollectionCountCache({ collectionSlug: updatedEntry.collection }),
    invalidateCmsNavigationCachesForCollection({ collectionSlug: updatedEntry.collection }),
    invalidateSitemapCache(),
  ]);

  return updatedEntry;
}
