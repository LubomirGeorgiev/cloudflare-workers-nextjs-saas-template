import { NextResponse } from "next/server";
import type { JSONContent } from "@tiptap/core";

import { cmsConfig, type CollectionsUnion } from "@/../cms.config";
import { CMS_ENTRY_STATUS } from "@/app/enums";
import { SITE_NAME } from "@/constants";
import { getCmsEntryBySlug } from "@/lib/cms/cms-repository";
import { renderContentToMarkdown } from "@/lib/cms/render-content-to-markdown";
import { CACHE_KEYS, withKVCache } from "@/utils/with-kv-cache";
import { RATE_LIMITS, withRateLimit } from "@/utils/with-rate-limit";

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      collection: string;
      slug: string;
    }>;
  }
) {
  return withRateLimit(async () => {
    const { collection, slug } = await params;
    const wantsDownload = new URL(request.url).searchParams.has("download");

    if (!(collection in cmsConfig.collections)) {
      return NextResponse.json(
        {
          error: "CMS collection not found",
        },
        {
          status: 404,
        }
      );
    }

    const entry = await getCmsEntryBySlug({
      collectionSlug: collection as CollectionsUnion,
      slug,
      status: CMS_ENTRY_STATUS.PUBLISHED,
    });

    if (!entry) {
      return NextResponse.json(
        {
          error: "CMS entry not found",
        },
        {
          status: 404,
        }
      );
    }

    const markdown = await withKVCache(
      async () => renderContentToMarkdown(entry.content as JSONContent),
      {
        key: `${CACHE_KEYS.CMS_ENTRY}:${collection}:${slug}:markdown`,
        ttl: "8 hours",
      }
    );

    const fileName = `${SITE_NAME.toLowerCase().replace(/\s+/g, "-")}-${entry.collection}-${entry.slug}.md`;

    const headers: Record<string, string> = {
      "content-type": "text/markdown; charset=utf-8",
    };

    if (wantsDownload) {
      headers["content-disposition"] = `attachment; filename="${fileName}"`;
    }

    return new Response(markdown, { headers });
  }, RATE_LIMITS.CMS_MARKDOWN_API);
}
