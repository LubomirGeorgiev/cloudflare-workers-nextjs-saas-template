import { buildDocsLlmsTxtContent } from "@/lib/cms/build-docs-llms-txt";
import { getCmsNavigationTree } from "@/lib/cms/cms-navigation-repository";
import { DOCS_SLUG } from "@/lib/cms/docs-config";
import { SITE_URL } from "@/constants";

export async function GET() {
  const tree = await getCmsNavigationTree({
    navigationKey: DOCS_SLUG,
  });

  if (tree.length === 0) {
    return Response.redirect(SITE_URL, 302);
  }
  const body = buildDocsLlmsTxtContent(tree);

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
