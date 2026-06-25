import { NextResponse } from "next/server";
import type { JSONContent } from "@tiptap/core";

import { cmsConfig, type CollectionsUnion } from "@/../cms.config";
import { CMS_ENTRY_STATUS } from "@/app/enums";
import { SITE_NAME } from "@/constants";
import { getCmsEntryBySlug } from "@/lib/cms/entry";
import { renderContentToMarkdown } from "@/lib/cms/render-content-to-markdown";
import { CACHE_TAGS, setCacheScope } from "@/utils/cache";
import { RATE_LIMITS, withRateLimit } from "@/utils/with-rate-limit";

interface CachedMarkdownEntry {
  collection: string;
  markdown: string;
  slug: string;
}

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

    const entry = await renderCachedEntryMarkdown({
      collectionSlug: collection as CollectionsUnion,
      slug,
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

    const fileName = `${SITE_NAME.toLowerCase().replace(/\s+/g, "-")}-${entry.collection}-${entry.slug}.md`;

    const headers: Record<string, string> = {
      "content-type": "text/markdown; charset=utf-8",
    };

    if (wantsDownload) {
      headers["content-disposition"] = `attachment; filename="${fileName}"`;
    }

    return new Response(entry.markdown, { headers });
  }, RATE_LIMITS.CMS_MARKDOWN_API);
}

async function renderCachedEntryMarkdown({
  collectionSlug,
  slug,
}: {
  collectionSlug: CollectionsUnion;
  slug: string;
}): Promise<CachedMarkdownEntry | null> {
  "use cache: remote";
  setCacheScope({
    tags: [
      CACHE_TAGS.cmsEntry({ collectionSlug, slug }),
    ],
    ttl: "8 hours",
  });

  const entry = await getCmsEntryBySlug({
    collectionSlug,
    slug,
    status: CMS_ENTRY_STATUS.PUBLISHED,
  });

  if (!entry) {
    return null;
  }

  return {
    collection: entry.collection,
    markdown: renderContentToMarkdown(entry.content as JSONContent),
    slug: entry.slug,
  };
}
