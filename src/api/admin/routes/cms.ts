import "server-only";

import { Hono } from "hono";

import { ADMIN_API_TAGS } from "@/api/admin/openapi-document";
import { adminOperation } from "@/api/admin/operation";
import { apiValidator } from "@/api/middleware/problem-json";
import { jsonResponse } from "@/api/openapi";
import type { ApiEnv } from "@/api/types";
import { ActionError } from "@/lib/action-error";
import { listAdminCmsEntries } from "@/lib/admin/cms";
import { publishCmsEntryNow } from "@/lib/cms/entry/publishing";
import { v } from "@/lib/validation";
import {
  adminCmsEntryIdParamSchema,
  adminCmsEntryListSchema,
  adminCmsEntrySchema,
  adminListCmsEntriesQuerySchema,
} from "@/schemas/api/admin.schema";

type CmsEntryResponse = v.InferOutput<typeof adminCmsEntrySchema>;

/** The heavy `content` and `fields` columns are deliberately absent: this is an index, not a read. */
function toCmsEntryResponse(entry: {
  id: string;
  collection: string;
  slug: string;
  title: string;
  status: string;
  locale: string | null;
  publishedAt: Date | null;
  updatedAt: Date | null;
}): CmsEntryResponse {
  return {
    id: entry.id,
    collection: entry.collection,
    slug: entry.slug,
    title: entry.title,
    status: entry.status,
    locale: entry.locale,
    publishedAt: entry.publishedAt ? entry.publishedAt.toISOString() : null,
    updatedAt: entry.updatedAt ? entry.updatedAt.toISOString() : null,
  };
}

export const adminCmsRoutes = new Hono<ApiEnv>()
  .get(
    "/cms/entries",
    ...adminOperation({
      operationId: "adminListCmsEntries",
      tags: [ADMIN_API_TAGS.cms],
      summary: "List CMS entries in a collection",
      description:
        "Lists entries in one configured CMS collection across every status and locale, including " +
        "drafts, scheduled, and archived entries that the public site never renders. Reads live " +
        "database state rather than the cached public projection, so an entry edited a moment ago " +
        "is already reflected here.",
      scope: "admin:read",
      responses: {
        200: jsonResponse({ description: "A page of CMS entries.", schema: adminCmsEntryListSchema }),
      },
    }),
    apiValidator("query", adminListCmsEntriesQuerySchema),
    async (c) => {
      const { collection, page, pageSize } = c.req.valid("query");
      const result = await listAdminCmsEntries({
        collectionSlug: collection,
        page,
        pageSize,
      });

      return c.json({
        ...result,
        entries: result.entries.map(toCmsEntryResponse),
      } satisfies v.InferOutput<typeof adminCmsEntryListSchema>);
    },
  )
  .post(
    "/cms/entries/:entryId/publish",
    ...adminOperation({
      operationId: "adminPublishCmsEntry",
      tags: [ADMIN_API_TAGS.cms],
      summary: "Publish a CMS entry",
      description:
        "Sets an entry's status to `published` and stamps `publishedAt` if it has none, which " +
        "makes it visible on the public site and purges the cached pages that render it. An entry " +
        "that is already published is returned unchanged, so this is safe to retry.",
      scope: "admin:write",
      responses: {
        200: jsonResponse({ description: "The published entry.", schema: adminCmsEntrySchema }),
      },
    }),
    apiValidator("param", adminCmsEntryIdParamSchema),
    async (c) => {
      const { entryId } = c.req.valid("param");
      const updated = await publishCmsEntryNow({ entryId });

      if (!updated) {
        throw new ActionError("NOT_FOUND", "CMS entry not found");
      }

      return c.json(toCmsEntryResponse(updated));
    },
  );
