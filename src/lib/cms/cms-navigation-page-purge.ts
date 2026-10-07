import { INDEXED_DOCS_ROUTES } from "@/constants/docs-routes";
import { DOCS_BASE_PATH } from "@/lib/cms/docs-config";

// The docs root and the docs app-route pages. No navigation tree names them, so the admin edge-HTML
// sweep and the CMS page purge (`selectCmsPagePurgeTargets`) both add them from here.
export const DOCS_EDGE_HTML_PATHNAMES = [
  DOCS_BASE_PATH,
  ...INDEXED_DOCS_ROUTES.map(({ pathname }) => pathname),
];
