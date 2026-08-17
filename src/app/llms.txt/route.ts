import { DOCS_LLMS_TXT_CACHE_CONTROL } from "@/constants/cache-control";
import { buildLlmsTxtContent } from "@/lib/cms/build-llms-txt";
import { getCmsNavigationTree } from "@/lib/cms/cms-navigation-repository";
import { DOCS_SLUG } from "@/lib/cms/docs-config";
import { getCmsCollection } from "@/lib/cms/entry";
import { CACHE_TAGS, setCacheScope } from "@/utils/cache";

async function getCachedLlmsTxtBody(): Promise<string> {
  "use cache: remote";
  setCacheScope({
    tags: [
      CACHE_TAGS.cmsNavigation(DOCS_SLUG),
      CACHE_TAGS.cmsCollection(DOCS_SLUG),
      CACHE_TAGS.cmsCollection("blog"),
    ],
    ttl: "8 hours",
  });

  const [blogEntries, docsNodes] = await Promise.all([
    getCmsCollection({
      collectionSlug: "blog",
      includeRelations: { createdByUser: true, tags: true },
    }),
    getCmsNavigationTree({ navigationKey: DOCS_SLUG }),
  ]);

  return buildLlmsTxtContent({ blogEntries, docsNodes });
}

export async function GET() {
  const body = await getCachedLlmsTxtBody();

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": DOCS_LLMS_TXT_CACHE_CONTROL,
    },
  });
}
