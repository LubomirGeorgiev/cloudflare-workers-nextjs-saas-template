import {
  API_AUTH_DOCS_PATH,
  API_DOCS_PATH,
  API_ERRORS_DOCS_PATH,
  API_OPENAPI_SPEC_PATH,
  MCP_DOCS_PATH,
} from "@/constants";
import { DOCS_LLMS_TXT_PATH } from "@/lib/cms/docs-config";

// ---------------------------------------------------------------------------
// The docs entries that are app routes rather than CMS documents, so they can never come from the
// navigation tree. The sidebar chrome, the mobile nav, the sitemap, and llms.txt all read this one
// list. Data only — icons live with the (client) renderer, prose with each machine surface.
//
// Order encodes narrative → reference → machine endpoint: the CMS tree renders above this list, so
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

export interface DocsRouteDescriptor {
  id: DocsRouteId;
  sectionId: DocsRouteSectionId;
  pathname: string;
  /** Message key under `Client.Docs.Navigation`. */
  labelKey: string;
  /** Rendered indented under its parent in the sidebar. */
  parentId?: DocsRouteId;
  /** False for machine endpoints served at a single non-localized URL, like llms.txt. */
  isLocalized: boolean;
  /** Sitemap priority; omitted for entries that are not indexable pages. */
  sitemapPriority?: number;
}

/** Sidebar order. */
const DOCS_ROUTES: readonly DocsRouteDescriptor[] = [
  {
    id: DOCS_ROUTE_IDS.AUTH_GUIDE,
    sectionId: DOCS_ROUTE_SECTION_IDS.API,
    pathname: API_AUTH_DOCS_PATH,
    labelKey: "authGuide",
    isLocalized: true,
    sitemapPriority: 0.7,
  },
  {
    id: DOCS_ROUTE_IDS.API_REFERENCE,
    sectionId: DOCS_ROUTE_SECTION_IDS.API,
    pathname: API_DOCS_PATH,
    labelKey: "apiReference",
    isLocalized: true,
    sitemapPriority: 0.7,
  },
  {
    id: DOCS_ROUTE_IDS.API_ERRORS,
    sectionId: DOCS_ROUTE_SECTION_IDS.API,
    pathname: API_ERRORS_DOCS_PATH,
    labelKey: "apiErrors",
    parentId: DOCS_ROUTE_IDS.API_REFERENCE,
    isLocalized: true,
    sitemapPriority: 0.5,
  },
  {
    id: DOCS_ROUTE_IDS.MCP_GUIDE,
    sectionId: DOCS_ROUTE_SECTION_IDS.API,
    pathname: MCP_DOCS_PATH,
    labelKey: "mcpGuide",
    isLocalized: true,
    sitemapPriority: 0.7,
  },
  {
    id: DOCS_ROUTE_IDS.LLMS_TXT,
    sectionId: DOCS_ROUTE_SECTION_IDS.MACHINE,
    pathname: DOCS_LLMS_TXT_PATH,
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

type IndexedDocsRoute = DocsRouteDescriptor & { sitemapPriority: number };

/** The subset a crawler and an agent should see listed: real pages, not machine endpoints. */
export const INDEXED_DOCS_ROUTES: readonly IndexedDocsRoute[] = DOCS_ROUTES.filter(
  (route): route is IndexedDocsRoute => route.sitemapPriority !== undefined
);
