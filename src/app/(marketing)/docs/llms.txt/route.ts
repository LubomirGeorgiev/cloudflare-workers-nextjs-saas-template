import { buildDocsLlmsTxtContent } from "@/lib/cms/build-docs-llms-txt";
import { getCmsNavigationTree } from "@/lib/cms/cms-navigation-repository";
import { DOCS_SLUG } from "@/lib/cms/docs-config";
import { SITE_URL } from "@/constants";
import { CACHE_TAGS, setCacheScope } from "@/utils/cache";

async function getCachedDocsLlmsTxtBody(): Promise<string | null> {
  "use cache: remote";
  setCacheScope({
    tags: [
      CACHE_TAGS.CMS_NAVIGATION,
      CACHE_TAGS.cmsNavigation(DOCS_SLUG),
      CACHE_TAGS.cmsCollection(DOCS_SLUG),
    ],
    ttl: "8 hours",
  });

  const tree = await getCmsNavigationTree({
    navigationKey: DOCS_SLUG,
  });

  if (tree.length === 0) {
    return null;
  }

  return buildDocsLlmsTxtContent(tree);
}

export async function GET() {
  const body = await getCachedDocsLlmsTxtBody();

  if (!body) {
    return Response.redirect(SITE_URL, 302);
  }

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
