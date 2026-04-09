import { buildDocsLlmsTxtContent } from "@/lib/cms/build-docs-llms-txt";
import { getCmsNavigationTree } from "@/lib/cms/cms-navigation-repository";
import { DOCS_SLUG } from "@/lib/cms/docs-config";

export async function GET() {
  const tree = await getCmsNavigationTree({
    navigationKey: DOCS_SLUG,
  });
  const body = buildDocsLlmsTxtContent(tree);

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
