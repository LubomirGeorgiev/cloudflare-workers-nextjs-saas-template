import "server-only";

import { eq } from "drizzle-orm";
import type { JSONContent } from "@tiptap/core";
import { getCloudflareContext } from "@/utils/cloudflare-context";
import { cmsConfig, type CollectionsUnion } from "@/../cms.config";
import { CACHE_KEYS, withKVCache } from "@/utils/with-kv-cache";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getDB } from "@/db";
import { cmsEntryTable } from "@/db/schema";
import { DOCS_BASE_PATH, DOCS_SLUG } from "@/lib/cms/docs-config";
import { extractTextFromContent } from "@/lib/cms/extract-text-from-content";
import { getCmsCollectionNavigationKey } from "@/lib/cms/cms-navigation-config";

const DEFAULT_CMS_SEARCH_LIMIT = 8;
const MAX_SEARCH_TOKENS = 6;
const CMS_SEARCH_CACHE_TTL = "6 hours";

export interface CmsSearchResult {
  entryId: string;
  title: string;
  slug: string;
  seoDescription: string | null;
  resolvedPath: string;
  snippet: string;
}

interface SyncCmsEntrySearchParams {
  entryId: string;
  collection: CollectionsUnion;
  slug: string;
  title: string;
  seoDescription: string | null;
  content: JSONContent;
}

interface SearchCmsParams {
  query: string;
  limit?: number;
}

interface SearchCmsCollectionParams {
  collectionSlug: CollectionsUnion;
  query: string;
  limit: number;
}

interface CmsSearchCollectionConfig {
  slug: CollectionsUnion;
  navigationKey: string | null;
  fallbackBasePath: string | null;
}

interface CmsSearchRow {
  entryId: string;
  title: string;
  slug: string;
  seoDescription: string | null;
  resolvedPath: string | null;
  snippet: string | null;
}

export function isCollectionSearchEnabled(collectionSlug: CollectionsUnion): boolean {
  return Object.values(cmsConfig.collections).some(
    (collection) =>
      collection.slug === collectionSlug
      && "enableSearch" in collection
      && collection.enableSearch
  );
}

function normalizeSearchBody(content: JSONContent): string {
  return extractTextFromContent(content).replace(/\s+/g, " ").trim();
}

function buildCmsSearchMatchQuery(query: string): string | null {
  const tokens = query
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.slice(0, MAX_SEARCH_TOKENS);

  if (!tokens || tokens.length === 0) {
    return null;
  }

  return tokens.map((token) => `${token}*`).join(" AND ");
}

function getCmsSearchCollectionConfig(collectionSlug: CollectionsUnion): CmsSearchCollectionConfig {
  const collection = Object.values(cmsConfig.collections).find(
    (collectionConfig) => collectionConfig.slug === collectionSlug
  );

  if (!collection) {
    throw new Error(`Unsupported CMS collection "${collectionSlug}"`);
  }

  const navigationKey = getCmsCollectionNavigationKey(collectionSlug);
  const fallbackBasePath = collectionSlug === DOCS_SLUG ? DOCS_BASE_PATH : null;

  return {
    slug: collectionSlug,
    navigationKey,
    fallbackBasePath,
  };
}

function getCmsSearchCacheKey({
  collectionSlug,
  query,
  limit,
}: {
  collectionSlug: CollectionsUnion;
  query: string;
  limit: number;
}): string {
  const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, " ");
  return `${CACHE_KEYS.CMS_SEARCH}:${collectionSlug}:${limit}:${encodeURIComponent(normalizedQuery)}`;
}

export async function invalidateCmsSearchCache(collectionSlug?: CollectionsUnion): Promise<void> {
  const { env } = await getCloudflareContext();
  const kv = env.NEXT_INC_CACHE_KV;

  if (!kv) {
    return;
  }

  const prefix = collectionSlug
    ? `${CACHE_KEYS.CMS_SEARCH}:${collectionSlug}:`
    : `${CACHE_KEYS.CMS_SEARCH}:`;

  let cursor: string | undefined;
  const keysToDelete: string[] = [];

  do {
    const result = await kv.list({
      prefix,
      cursor,
    });
    keysToDelete.push(...result.keys.map((key) => key.name));
    cursor = !result.list_complete && "cursor" in result ? result.cursor : undefined;
  } while (cursor);

  if (keysToDelete.length > 0) {
    await Promise.all(keysToDelete.map((key) => kv.delete(key)));
  }
}

export async function invalidateDocsSearchCache(): Promise<void> {
  await invalidateCmsSearchCache(DOCS_SLUG);
}

async function getSearchDatabase(): Promise<D1Database> {
  const { env } = await getCloudflareContext();

  if (!env.NEXT_TAG_CACHE_D1) {
    throw new Error("D1 database not found");
  }

  return env.NEXT_TAG_CACHE_D1;
}

async function optimizeCmsSearchIndex(d1: D1Database): Promise<void> {
  await d1.prepare("INSERT INTO cms_entry_search(cms_entry_search) VALUES('optimize')").run();
}

export async function rebuildCmsSearchIndex(collectionSlug: CollectionsUnion): Promise<void> {
  const db = getDB();
  const entries = await db.query.cmsEntryTable.findMany({
    where: eq(cmsEntryTable.collection, collectionSlug),
    columns: {
      id: true,
      collection: true,
      slug: true,
      title: true,
      seoDescription: true,
      content: true,
    },
  });

  const d1 = await getSearchDatabase();
  const statements = entries.length === 0
    ? [d1.prepare("DELETE FROM cms_entry_search WHERE collection = ?").bind(collectionSlug)]
    : [
        d1.prepare("DELETE FROM cms_entry_search WHERE collection = ?").bind(collectionSlug),
        ...entries.map((entry) =>
          d1
            .prepare(
              "INSERT INTO cms_entry_search(entryId, collection, slug, title, seoDescription, body) VALUES (?, ?, ?, ?, ?, ?)"
            )
            .bind(
              entry.id,
              entry.collection,
              entry.slug,
              entry.title,
              entry.seoDescription ?? "",
              normalizeSearchBody(entry.content)
            )
        ),
      ];

  await d1.batch(statements);
  await optimizeCmsSearchIndex(d1);
}

async function ensureCmsSearchIndex(collectionSlug: CollectionsUnion): Promise<void> {
  const d1 = await getSearchDatabase();
  const existingRows = await d1
    .prepare("SELECT count(*) as count FROM cms_entry_search WHERE collection = ?")
    .bind(collectionSlug)
    .first<{ count: number | string }>();

  if (Number(existingRows?.count ?? 0) === 0) {
    await rebuildCmsSearchIndex(collectionSlug);
  }
}

export async function syncCmsEntrySearch({
  entryId,
  collection,
  slug,
  title,
  seoDescription,
  content,
}: SyncCmsEntrySearchParams): Promise<void> {
  const d1 = await getSearchDatabase();

  if (!isCollectionSearchEnabled(collection)) {
    await d1.prepare("DELETE FROM cms_entry_search WHERE entryId = ?").bind(entryId).run();
    await optimizeCmsSearchIndex(d1);
    return;
  }

  await d1.batch([
    d1.prepare("DELETE FROM cms_entry_search WHERE entryId = ?").bind(entryId),
    d1
      .prepare(
        "INSERT INTO cms_entry_search(entryId, collection, slug, title, seoDescription, body) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .bind(
        entryId,
        collection,
        slug,
        title,
        seoDescription ?? "",
        normalizeSearchBody(content)
      ),
  ]);
}

export async function removeCmsEntrySearch({
  entryId,
}: {
  entryId: string;
}): Promise<void> {
  const d1 = await getSearchDatabase();
  await d1.prepare("DELETE FROM cms_entry_search WHERE entryId = ?").bind(entryId).run();
  await optimizeCmsSearchIndex(d1);
}

export async function searchCmsCollection({
  collectionSlug,
  query,
  limit,
}: SearchCmsCollectionParams): Promise<CmsSearchResult[]> {
  const collectionConfig = getCmsSearchCollectionConfig(collectionSlug);

  if (!isCollectionSearchEnabled(collectionSlug)) {
    return [];
  }

  const matchQuery = buildCmsSearchMatchQuery(query);

  if (!matchQuery) {
    return [];
  }

  await ensureCmsSearchIndex(collectionSlug);

  return withKVCache(async () => {
    const d1 = await getSearchDatabase();
    const result = await d1
      .prepare(
        `SELECT
          search.entryId as entryId,
          entry.title as title,
          entry.slug as slug,
          entry.seoDescription as seoDescription,
          navigation.resolvedPath as resolvedPath,
          snippet(cms_entry_search, 5, '', '', ' ... ', 18) as snippet
        FROM cms_entry_search AS search
        INNER JOIN cms_entry AS entry
          ON entry.id = search.entryId
        LEFT JOIN cms_navigation_item AS navigation
          ON navigation.entryId = entry.id
          AND navigation.navigationKey = ?
        WHERE cms_entry_search MATCH ?
          AND entry.collection = ?
          AND entry.status = ?
        ORDER BY bm25(cms_entry_search, 0.0, 0.0, 0.0, 8.0, 3.0, 1.5)
        LIMIT ?`
      )
      .bind(
        collectionConfig.navigationKey,
        matchQuery,
        collectionSlug,
        CMS_ENTRY_STATUS.PUBLISHED,
        limit
      )
      .all<CmsSearchRow>();

    return (result.results ?? []).map((row) => ({
      entryId: row.entryId,
      title: row.title,
      slug: row.slug,
      seoDescription: row.seoDescription,
      resolvedPath:
        row.resolvedPath
        ?? collectionConfig.fallbackBasePath
        ?? `/${collectionSlug}/${row.slug}`,
      snippet: row.snippet?.trim() || row.seoDescription || row.title,
    }));
  }, {
    key: getCmsSearchCacheKey({ collectionSlug, query, limit }),
    ttl: CMS_SEARCH_CACHE_TTL,
  });
}

export type DocsSearchResult = CmsSearchResult;

export async function searchDocs({
  query,
  limit = DEFAULT_CMS_SEARCH_LIMIT,
}: SearchCmsParams): Promise<DocsSearchResult[]> {
  return searchCmsCollection({
    collectionSlug: DOCS_SLUG,
    query,
    limit,
  });
}
