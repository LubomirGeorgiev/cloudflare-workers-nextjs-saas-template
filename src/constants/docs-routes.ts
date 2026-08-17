import {
  API_AUTH_DOCS_PATH,
  API_DOCS_PATH,
  API_ERRORS_DOCS_PATH,
  API_OPENAPI_SPEC_PATH,
  LLMS_TXT_PATH,
  MCP_DOCS_PATH,
} from "@/constants";
import type { TranslatorNamespace } from "@/i18n/translator";

// ---------------------------------------------------------------------------
// The docs entries that are app routes rather than CMS documents, so they can never come from the
// navigation tree. The sidebar chrome, the mobile nav, the sitemap, and llms.txt all read this one
// list. Data only — icons live with the (client) renderer, prose with each machine surface.
//
// Order encodes reference → guides → machine endpoint: the CMS tree renders above this list, so
// these are what a reader reaches after the guides, ending with the surfaces only agents open.
// ---------------------------------------------------------------------------

const DOCS_ROUTE_IDS = {
  LLMS_TXT: "llmsTxt",
  OPENAPI_DOCUMENT: "openApiDocument",
  API_REFERENCE: "apiReference",
  API_ERRORS: "apiErrors",
  AUTH_GUIDE: "authGuide",
  MCP_GUIDE: "mcpGuide",
} as const;

export type DocsRouteId = (typeof DOCS_ROUTE_IDS)[keyof typeof DOCS_ROUTE_IDS];

/** Sidebar sections, rendered with the same heading treatment as a CMS `GROUP` node. */
const DOCS_ROUTE_SECTION_IDS = {
  API: "api",
  MACHINE: "machine",
} as const;

type DocsRouteSectionId =
  (typeof DOCS_ROUTE_SECTION_IDS)[keyof typeof DOCS_ROUTE_SECTION_IDS];

/** Message keys under `Client.Docs.Navigation`. */
const DOCS_ROUTE_SECTION_LABEL_KEYS: Record<DocsRouteSectionId, string> = {
  [DOCS_ROUTE_SECTION_IDS.API]: "apiSection",
  [DOCS_ROUTE_SECTION_IDS.MACHINE]: "machineSection",
};

interface DocsRouteBase {
  id: DocsRouteId;
  sectionId: DocsRouteSectionId;
  pathname: string;
  /** Message key under `Client.Docs.Navigation`. */
  labelKey: string;
  /** Rendered indented under its parent in the sidebar. */
  parentId?: DocsRouteId;
}

/** A page a reader opens. Both indexing fields are required, so no page can drop out silently. */
export interface DocsPageRoute extends DocsRouteBase {
  isLocalized: true;
  /** Sitemap priority. */
  sitemapPriority: number;
  /** Namespace whose meta title and description also describe this route to agents. */
  metaNamespace: TranslatorNamespace;
}

/** A machine endpoint served at a single non-localized URL, like llms.txt. Never indexed. */
interface DocsMachineRoute extends DocsRouteBase {
  isLocalized: false;
  sitemapPriority?: never;
  metaNamespace?: never;
}

export type DocsRouteDescriptor = DocsPageRoute | DocsMachineRoute;

/** Sidebar order. Exported for the co-located test that guards the page/machine split. */
export const DOCS_ROUTES: readonly DocsRouteDescriptor[] = [
  {
    id: DOCS_ROUTE_IDS.API_REFERENCE,
    sectionId: DOCS_ROUTE_SECTION_IDS.API,
    pathname: API_DOCS_PATH,
    labelKey: "apiReference",
    metaNamespace: "Client.Docs.ApiReference.meta",
    isLocalized: true,
    sitemapPriority: 0.7,
  },
  {
    id: DOCS_ROUTE_IDS.API_ERRORS,
    sectionId: DOCS_ROUTE_SECTION_IDS.API,
    pathname: API_ERRORS_DOCS_PATH,
    labelKey: "apiErrors",
    metaNamespace: "Client.Docs.ApiErrors.meta",
    parentId: DOCS_ROUTE_IDS.API_REFERENCE,
    isLocalized: true,
    sitemapPriority: 0.5,
  },
  {
    id: DOCS_ROUTE_IDS.AUTH_GUIDE,
    sectionId: DOCS_ROUTE_SECTION_IDS.API,
    pathname: API_AUTH_DOCS_PATH,
    labelKey: "authGuide",
    metaNamespace: "Client.Docs.Auth.meta",
    isLocalized: true,
    sitemapPriority: 0.7,
  },
  {
    id: DOCS_ROUTE_IDS.MCP_GUIDE,
    sectionId: DOCS_ROUTE_SECTION_IDS.API,
    pathname: MCP_DOCS_PATH,
    labelKey: "mcpGuide",
    metaNamespace: "Client.Docs.Mcp.meta",
    isLocalized: true,
    sitemapPriority: 0.7,
  },
  {
    id: DOCS_ROUTE_IDS.LLMS_TXT,
    sectionId: DOCS_ROUTE_SECTION_IDS.MACHINE,
    pathname: LLMS_TXT_PATH,
    labelKey: "llmsTxt",
    isLocalized: false,
  },
  {
    id: DOCS_ROUTE_IDS.OPENAPI_DOCUMENT,
    sectionId: DOCS_ROUTE_SECTION_IDS.MACHINE,
    pathname: API_OPENAPI_SPEC_PATH,
    labelKey: "openApiDocument",
    isLocalized: false,
  },
] as const;

interface DocsRouteSection {
  id: DocsRouteSectionId;
  labelKey: string;
  /** Each top-level entry followed by its children, in sidebar rendering order. */
  groups: readonly (readonly DocsRouteDescriptor[])[];
}

/** Sidebar rendering order: sections, then each top-level entry followed by its children. */
export const DOCS_ROUTE_SECTIONS: readonly DocsRouteSection[] = Object.values(
  DOCS_ROUTE_SECTION_IDS
).map((sectionId) => {
  const routes = DOCS_ROUTES.filter((route) => route.sectionId === sectionId);

  return {
    id: sectionId,
    labelKey: DOCS_ROUTE_SECTION_LABEL_KEYS[sectionId],
    groups: routes
      .filter((route) => !route.parentId)
      .map((parent) => [parent, ...routes.filter((route) => route.parentId === parent.id)]),
  };
});

function isDocsPageRoute(route: DocsRouteDescriptor): route is DocsPageRoute {
  return route.isLocalized;
}

/**
 * The subset a crawler and an agent should see listed: real pages, not machine endpoints. It feeds
 * the sitemap, docs search, llms.txt, and the `.md` allowlist. The split reads the route kind, not
 * which fields happen to be set, so a fork's new page route fails the build until both are there.
 */
export const INDEXED_DOCS_ROUTES: readonly DocsPageRoute[] =
  DOCS_ROUTES.filter(isDocsPageRoute);
