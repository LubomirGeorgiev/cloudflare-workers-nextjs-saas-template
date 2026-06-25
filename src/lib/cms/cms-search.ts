import "server-only";

import type { JSONContent } from "@tiptap/core";
import { env as workerEnv } from "cloudflare:workers";
import { cmsConfig, type CollectionsUnion } from "@/../cms.config";
import { CACHE_TAGS, revalidateCacheTag, setCacheScope } from "@/utils/cache";

import { CMS_ENTRY_STATUS } from "@/app/enums";
import { getDB } from "@/db";
import { DOCS_BASE_PATH, DOCS_SLUG } from "@/lib/cms/docs-config";
import { extractTextFromContent } from "@/lib/cms/extract-text-from-content";
import { getCmsCollectionNavigationKey } from "@/lib/cms/cms-navigation-config";

const DEFAULT_CMS_SEARCH_LIMIT = 8;
const MAX_SEARCH_TOKENS = 6;
const CMS_SEARCH_CACHE_TTL = "6 hours";
const INSERT_CMS_ENTRY_SEARCH_SQL =
  "INSERT INTO cms_entry_search(entryId, collection, slug, title, seoDescription, body) VALUES (?, ?, ?, ?, ?, ?)";

// oxlint-disable-next-line project/no-unused-module-exports -- CMS modules intentionally expose helpers for admin/tooling extensions.
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

interface PrepareCmsEntrySearchInsertParams extends SyncCmsEntrySearchParams {
  d1: D1Database;
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

export async function invalidateCmsSearchCache(collectionSlug?: CollectionsUnion): Promise<void> {
  const collectionSlugs = collectionSlug
    ? [collectionSlug]
    : Object.entries(cmsConfig.collections)
      .filter(([, collection]) => "enableSearch" in collection && collection.enableSearch)
      .map(([slug]) => slug as CollectionsUnion);

  collectionSlugs.forEach((slug) => revalidateCacheTag(CACHE_TAGS.cmsSearchCollection(slug)));
}

// oxlint-disable-next-line project/no-unused-module-exports -- CMS modules intentionally expose helpers for admin/tooling extensions.
export async function invalidateDocsSearchCache(): Promise<void> {
  await invalidateCmsSearchCache(DOCS_SLUG);
}

async function getSearchDatabase(): Promise<D1Database> {
  if (!workerEnv.NEXT_TAG_CACHE_D1) {
    throw new Error("D1 database not found");
  }

  return workerEnv.NEXT_TAG_CACHE_D1;
}

async function optimizeCmsSearchIndex(d1: D1Database): Promise<void> {
  await d1.prepare("INSERT INTO cms_entry_search(cms_entry_search) VALUES('optimize')").run();
}

function prepareCmsEntrySearchInsert({
  d1,
  entryId,
  collection,
  slug,
  title,
  seoDescription,
  content,
}: PrepareCmsEntrySearchInsertParams): D1PreparedStatement {
  return d1
    .prepare(INSERT_CMS_ENTRY_SEARCH_SQL)
    .bind(
      entryId,
      collection,
      slug,
      title,
      seoDescription ?? "",
      normalizeSearchBody(content)
    );
}

export async function rebuildCmsSearchIndex(collectionSlug: CollectionsUnion): Promise<void> {
  const db = getDB();
  const entries = await db.query.cmsEntryTable.findMany({
    where: { collection: collectionSlug },
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
          prepareCmsEntrySearchInsert({
            d1,
            entryId: entry.id,
            collection: entry.collection,
            slug: entry.slug,
            title: entry.title,
            seoDescription: entry.seoDescription,
            content: entry.content,
          })
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
    prepareCmsEntrySearchInsert({
      d1,
      entryId,
      collection,
      slug,
      title,
      seoDescription,
      content,
    }),
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

// oxlint-disable-next-line project/no-unused-module-exports -- CMS modules intentionally expose helpers for admin/tooling extensions.
export async function searchCmsCollection({
  collectionSlug,
  query,
  limit,
}: SearchCmsCollectionParams): Promise<CmsSearchResult[]> {
  if (!isCollectionSearchEnabled(collectionSlug)) {
    return [];
  }

  const matchQuery = buildCmsSearchMatchQuery(query);

  if (!matchQuery) {
    return [];
  }

  return getCachedCmsSearchResults({
    collectionSlug,
    limit,
    matchQuery,
    query: query.trim().toLowerCase().replace(/\s+/g, " "),
  });
}

async function getCachedCmsSearchResults({
  collectionSlug,
  matchQuery,
  limit,
}: {
  collectionSlug: CollectionsUnion;
  query: string;
  matchQuery: string;
  limit: number;
}): Promise<CmsSearchResult[]> {
  "use cache: remote";
  setCacheScope({
    tags: [
      CACHE_TAGS.cmsSearchCollection(collectionSlug),
    ],
    ttl: CMS_SEARCH_CACHE_TTL,
  });

  const collectionConfig = getCmsSearchCollectionConfig(collectionSlug);
  await ensureCmsSearchIndex(collectionSlug);

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
}

// oxlint-disable-next-line project/no-unused-module-exports -- CMS modules intentionally expose helpers for admin/tooling extensions.
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
