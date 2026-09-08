import "server-only";

import { Hono } from "hono";

import { ADMIN_API_TAGS } from "@/api/admin/openapi-document";
import { adminOperation } from "@/api/admin/operation";
import { apiValidator } from "@/api/middleware/problem-json";
import { jsonResponse } from "@/api/openapi";
import type { ApiEnv } from "@/api/types";
import { EDGE_HTML_CACHE_TTL_SECONDS } from "@/constants/cache-control";
import {
  clearCmsCache,
  clearSearchCache,
  purgeCloudflareCdnCache,
  purgeEdgeHtmlCache,
  purgeKvPageCaches,
  purgeWorkersCdnCache,
  rebuildSearchIndexes,
} from "@/lib/admin/system-actions";
import { v } from "@/lib/validation";
import {
  adminPurgeCountResultSchema,
  adminSystemActionResultSchema,
  adminSystemCollectionBodySchema,
  adminSystemPurgeConfirmBodySchema,
} from "@/schemas/api/admin.schema";

// The maintenance surface of the admin panel's system panel. Every handler calls one service
// function from `src/lib/admin/system-actions.ts`, the same code path the server action uses.

type SystemActionResponse = v.InferOutput<typeof adminSystemActionResultSchema>;

const COLLECTION_BODY_NOTE =
  "The JSON body is required even when it is empty: send `{}` to act on every collection, or " +
  "`{\"collection\":\"<slug>\"}` for one. An unknown slug is rejected as an invalid field.";

const CONFIRM_BODY_NOTE =
  "This operation is destructive, so it takes an explicit confirmation: the JSON body must be " +
  "`{\"confirm\":true}`. A request without it, or with any other value, is refused as an invalid " +
  "field and purges nothing.";

export const adminSystemRoutes = new Hono<ApiEnv>()
  .post(
    "/system/search-index/rebuild",
    ...adminOperation({
      operationId: "adminRebuildSearchIndex",
      tags: [ADMIN_API_TAGS.system],
      summary: "Rebuild the CMS search index",
      description:
        "Re-reads every published entry of a searchable CMS collection and rewrites its full-text " +
        "search rows from scratch, then drops the cached search results for it. Use it after a " +
        "bulk import or when search returns stale or missing entries. Omit `collection` to rebuild " +
        "every collection that has search enabled. Rejects a collection whose search is disabled, " +
        "and rejects the whole request when no collection has search enabled at all. The work is " +
        "proportional to the number of entries. The rebuild is safe to repeat, and a rebuild that " +
        "overlaps another rebuild of the same collection only does the same work twice. " +
        COLLECTION_BODY_NOTE,
      scope: "admin:write",
      responses: {
        200: jsonResponse({
          description: "What was rebuilt.",
          schema: adminSystemActionResultSchema,
        }),
      },
    }),
    apiValidator("json", adminSystemCollectionBodySchema),
    async (c) => {
      const { collection } = c.req.valid("json");
      const result = await rebuildSearchIndexes(collection);

      return c.json({ message: result.message } satisfies SystemActionResponse);
    },
  )
  .post(
    "/system/search-cache/clear",
    ...adminOperation({
      operationId: "adminClearSearchCache",
      tags: [ADMIN_API_TAGS.system],
      summary: "Clear the CMS search result cache",
      description:
        "Drops the cached search results of a CMS collection, so the next query is answered from " +
        "the search index instead of a stored response. It does not touch the index itself — use " +
        "the rebuild operation when the index is wrong rather than the cache. Omit `collection` " +
        "to clear every collection. Rejects a collection whose search is disabled. " +
        COLLECTION_BODY_NOTE,
      scope: "admin:write",
      responses: {
        200: jsonResponse({
          description: "What was cleared.",
          schema: adminSystemActionResultSchema,
        }),
      },
    }),
    apiValidator("json", adminSystemCollectionBodySchema),
    async (c) => {
      const { collection } = c.req.valid("json");
      const result = await clearSearchCache(collection);

      return c.json({ message: result.message } satisfies SystemActionResponse);
    },
  )
  .post(
    "/system/cms-cache/clear",
    ...adminOperation({
      operationId: "adminClearCmsCache",
      tags: [ADMIN_API_TAGS.system],
      summary: "Clear every cached CMS read",
      description:
        "Invalidates the cache tags behind every CMS entry, collection listing, navigation tree, " +
        "and redirect map, plus the cached search results. The next request for each of those " +
        "reads the database again. Takes no arguments and returns a sentence naming what ran.",
      scope: "admin:write",
      responses: {
        200: jsonResponse({
          description: "What was cleared.",
          schema: adminSystemActionResultSchema,
        }),
      },
    }),
    async (c) => {
      const result = await clearCmsCache();

      return c.json({ message: result.message } satisfies SystemActionResponse);
    },
  )
  .post(
    "/system/kv-page-cache/purge",
    ...adminOperation({
      operationId: "adminPurgeKvPageCache",
      tags: [ADMIN_API_TAGS.system],
      summary: "Purge the KV page cache",
      description:
        "Deletes every rendered-page key the Worker stores in KV: the Vinext page cache and the " +
        "Markdown twins of the public pages. The next visitor renders each page again, so a large " +
        "purge costs origin work. Returns `deletedKeyCount`, the number of keys actually deleted. " +
        "It empties no CMS cache tag and no CDN cache; those are separate operations. " +
        CONFIRM_BODY_NOTE,
      scope: "admin:write",
      responses: {
        200: jsonResponse({
          description: "How many cache keys were deleted.",
          schema: adminPurgeCountResultSchema,
        }),
      },
    }),
    apiValidator("json", adminSystemPurgeConfirmBodySchema),
    async (c) => {
      const result = await purgeKvPageCaches();

      return c.json({
        message: result.message,
        deletedKeyCount: result.deletedKeyCount,
      } satisfies v.InferOutput<typeof adminPurgeCountResultSchema>);
    },
  )
  .post(
    "/system/cdn-cache/purge",
    ...adminOperation({
      operationId: "adminPurgeCdnCache",
      tags: [ADMIN_API_TAGS.system],
      summary: "Purge the Workers CDN cache",
      description:
        "Purges everything this zone holds in Workers Caching, for every URL at once: the " +
        "sitemap, robots.txt, llms.txt, the generated OpenGraph cards, `/markdown/*` and the " +
        "`.md` twins, the docs search responses, and the published OpenAPI document. There is no " +
        "per-path form. It never clears the stored anonymous HTML pages, which live in the Cache " +
        "API and have their own purge operation, and it never deletes a KV key. Every edge " +
        "location refetches those machine responses from the Worker afterwards, so expect a " +
        "traffic spike on a busy deployment. Answers with a server error naming the reason when " +
        "Cloudflare refuses the purge. " +
        CONFIRM_BODY_NOTE,
      scope: "admin:write",
      responses: {
        200: jsonResponse({
          description: "What was purged.",
          schema: adminSystemActionResultSchema,
        }),
      },
    }),
    apiValidator("json", adminSystemPurgeConfirmBodySchema),
    async (c) => {
      const result = await purgeWorkersCdnCache();

      return c.json({ message: result.message } satisfies SystemActionResponse);
    },
  )
  .post(
    "/system/edge-html-cache/purge",
    ...adminOperation({
      operationId: "adminPurgeEdgeHtmlCache",
      tags: [ADMIN_API_TAGS.system],
      summary: "Purge the stored edge HTML pages",
      description:
        "Deletes the stored anonymous copies of the public HTML pages from the Cloudflare Cache " +
        "API. The Cache API is per data center, so this clears the data center that answers this " +
        "request; with Smart Placement enabled that is the one that stored the pages. A copy in " +
        "any other location expires on its own within " +
        `${EDGE_HTML_CACHE_TTL_SECONDS} seconds. It touches neither the KV page cache nor ` +
        "Workers Caching — both are separate operations. The pages named are the ones the " +
        "sitemap knows: the static public routes, the blog listing and facet pages, the " +
        "published CMS entry pages, and the docs pages, each in every served locale. Returns " +
        "`deletedKeyCount`, the number of stored pages actually deleted. " +
        CONFIRM_BODY_NOTE,
      scope: "admin:write",
      responses: {
        200: jsonResponse({
          description: "How many stored pages were deleted.",
          schema: adminPurgeCountResultSchema,
        }),
      },
    }),
    apiValidator("json", adminSystemPurgeConfirmBodySchema),
    async (c) => {
      const result = await purgeEdgeHtmlCache();

      return c.json({
        message: result.message,
        deletedKeyCount: result.deletedKeyCount,
      } satisfies v.InferOutput<typeof adminPurgeCountResultSchema>);
    },
  )
  .post(
    "/system/cloudflare-cdn-cache/purge",
    ...adminOperation({
      operationId: "adminPurgeCloudflareCdnCache",
      tags: [ADMIN_API_TAGS.system],
      summary: "Purge the whole Cloudflare CDN cache",
      description:
        "Purges the whole zone cache at Cloudflare, for every URL this site serves: the static " +
        "assets, the stored HTML page copies in every data center, and every machine response " +
        "alike. It is global, not per data center, and it is the same purge the deploy workflow " +
        "runs after a release. There is no per-path form. Every location refetches from the " +
        "Worker afterwards, so expect a traffic spike and slower first responses on a busy " +
        "deployment. Refused with `PRECONDITION_FAILED` when the Worker has no Cloudflare " +
        "credential for the purge: it needs a `CLOUDFLARE_API_TOKEN` carrying the Cache Purge " +
        "permission and a `CLOUDFLARE_ACCOUNT_ID`, or a `CLOUDFLARE_ZONE_ID` naming the zone. " +
        "Answers with a server error naming the reason when Cloudflare refuses the purge. " +
        CONFIRM_BODY_NOTE,
      scope: "admin:write",
      responses: {
        200: jsonResponse({
          description: "What was purged.",
          schema: adminSystemActionResultSchema,
        }),
      },
    }),
    apiValidator("json", adminSystemPurgeConfirmBodySchema),
    async (c) => {
      const result = await purgeCloudflareCdnCache();

      return c.json({ message: result.message } satisfies SystemActionResponse);
    },
  );
