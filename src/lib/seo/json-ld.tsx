import "server-only";

import type { ImageObject, Organization, SoftwareApplication, WebSite } from "schema-dts";

import { GITHUB_REPO_URL, SITE_NAME, SITE_URL } from "@/constants";
import { SITE_LOGO } from "@/constants/logo";
import { SITE_LOGO_URL } from "@/constants/logo-url";
import { DEFAULT_LOCALE, ENABLED_LOCALES, type Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/translator";
import { absoluteLocalizedUrl } from "@/utils/i18n-urls";

// schema.org lets a node carry several `@type`s — a landing page that is also an `FAQPage`, a docs
// page that is also a `TechArticle` — which schema-dts models as one literal. Page graphs are built
// as these plain nodes; schema-dts stays inside this module, where every shape is fixed.
export type JsonLdNode = Record<string, unknown> & {
  "@type": string | readonly string[];
  "@id"?: string;
};

/** Extra `@type`s a page node may carry beside `WebPage`. A closed set, so a typo cannot ship. */
type ExtraPageType = "CollectionPage" | "ProfilePage" | "FAQPage";

/** A pointer to a node defined elsewhere in the graph — the whole point of the stable `@id`s. */
interface JsonLdReference {
  "@id": string;
}

interface JsonLdGraph {
  "@context": "https://schema.org";
  "@graph": readonly JsonLdNode[];
}

// Stable `@id`s for the site-level nodes every page emits. Page nodes reference these instead of
// repeating them, so a crawler merges one organization and one site across every URL.
export const ORGANIZATION_SCHEMA_ID = `${SITE_URL}/#organization`;
export const WEBSITE_SCHEMA_ID = `${SITE_URL}/#website`;
export const SOFTWARE_SCHEMA_ID = `${SITE_URL}/#software`;
// File-local: each is only ever reached through the node that embeds it.
const LOGO_SCHEMA_ID = `${SITE_URL}/#logo`;

// `applicationCategory` from Google's supported list. A fork changes the site, not this: every
// template built on it is still a web application a developer signs into.
const APPLICATION_CATEGORY = "BusinessApplication";

// Every `@id` fragment the site mints. Cross-page identity only works when two pages that mention
// one entity agree character for character, so the vocabulary is a closed map here rather than a
// template literal at each call site.
const SCHEMA_ID_FRAGMENTS = {
  page: "webpage",
  breadcrumb: "breadcrumb",
  article: "article",
  person: "person",
  blog: "blog",
  term: "term",
  itemList: "itemlist",
} as const;

type SchemaIdKind = keyof typeof SCHEMA_ID_FRAGMENTS;

interface ContentLocaleOptions {
  /** The active locale, from the `/[locale]/...` route param. */
  locale: Locale;
  /** True when this render serves default-locale content under another locale's prefix. */
  isFallback?: boolean;
}

/**
 * A fallback render canonicalizes to the default-locale URL, so its `@id`s must too. Decided only here.
 */
export function contentLocale({ locale, isFallback = false }: ContentLocaleOptions): Locale {
  return isFallback ? DEFAULT_LOCALE : locale;
}

interface SchemaIdOptions extends ContentLocaleOptions {
  kind: SchemaIdKind;
  /** Locale-agnostic pathname of the page that owns the entity. */
  pathname: string;
}

/** The `@id` of one entity, from the page that owns it. The only way to mint a fragment id. */
export function schemaId({ kind, pathname, locale, isFallback }: SchemaIdOptions): string {
  const url = absoluteLocalizedUrl({ pathname, locale: contentLocale({ locale, isFallback }) });

  return `${url}#${SCHEMA_ID_FRAGMENTS[kind]}`;
}

/** The page node's own `@id`, so `isPartOf`/`mainEntityOfPage` can point at one URL's page. */
export function pageSchemaId(url: string): string {
  return `${url}#${SCHEMA_ID_FRAGMENTS.page}`;
}

function breadcrumbSchemaId(url: string): string {
  return `${url}#${SCHEMA_ID_FRAGMENTS.breadcrumb}`;
}

// `</script>` inside any string value would close the tag early, so the one character that can do
// it is written as its JSON escape. `<` parses back to `<`, leaving the payload unchanged.
export function serializeJsonLd(graph: JsonLdGraph | object): string {
  return JSON.stringify(graph).replaceAll("<", "\\u003c");
}

/** The one way structured data reaches the DOM; never hand-write the script tag. */
export function JsonLd({ graph }: { graph: JsonLdGraph }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(graph) }}
    />
  );
}

function jsonLdGraph(nodes: readonly JsonLdNode[]): JsonLdGraph {
  return {
    "@context": "https://schema.org",
    "@graph": nodes,
  };
}

// Every value stays locale-invariant because the `@id`s are: `/en/...` and `/es/...` publish these
// nodes under the same ids, so a per-locale property would make the merged entity depend on which
// URL a crawler reached first. No pathname either — `headers()` would make every route dynamic.
export async function buildSiteJsonLd(): Promise<JsonLdGraph> {
  const t = await getTranslator({ locale: DEFAULT_LOCALE, namespace: "Landing.meta" });
  const description = t("description");

  // A top-level node rather than one nested under `logo`: `Organization.image` and
  // `SoftwareApplication.image` both point at it, and a reference only resolves reliably when the
  // target sits in the graph itself instead of inside another node.
  const logo: ImageObject = {
    "@type": "ImageObject",
    "@id": LOGO_SCHEMA_ID,
    url: SITE_LOGO_URL,
    contentUrl: SITE_LOGO_URL,
    // Intrinsic pixels of the generated PNG, which Google asks a logo to state. As text, because
    // schema.org ranges both over `Distance`; every consumer reads the number back out of it.
    width: `${SITE_LOGO.width}`,
    height: `${SITE_LOGO.height}`,
    caption: SITE_NAME,
  };

  const organization: Organization = {
    "@type": "Organization",
    "@id": ORGANIZATION_SCHEMA_ID,
    name: SITE_NAME,
    url: SITE_URL,
    logo: { "@id": LOGO_SCHEMA_ID },
    image: { "@id": LOGO_SCHEMA_ID },
    sameAs: [GITHUB_REPO_URL],
  };

  const website: WebSite = {
    "@type": "WebSite",
    "@id": WEBSITE_SCHEMA_ID,
    name: SITE_NAME,
    description,
    url: SITE_URL,
    inLanguage: ENABLED_LOCALES,
    publisher: { "@id": ORGANIZATION_SCHEMA_ID },
    about: { "@id": SOFTWARE_SCHEMA_ID },
  };

  // What the site actually is, for an answer engine asked "what is <site>?". No `offers` and no
  // `aggregateRating`: neither is visible on the marketing pages, and Google's policy is that
  // structured data describes content the visitor can see.
  const software: SoftwareApplication = {
    "@type": "SoftwareApplication",
    "@id": SOFTWARE_SCHEMA_ID,
    name: SITE_NAME,
    description,
    url: SITE_URL,
    applicationCategory: APPLICATION_CATEGORY,
    operatingSystem: "Web browser",
    image: { "@id": LOGO_SCHEMA_ID },
    publisher: { "@id": ORGANIZATION_SCHEMA_ID },
    sameAs: [GITHUB_REPO_URL],
  };

  // The one widening in the codebase: schema-dts checked these four shapes, and its interfaces
  // carry no index signature, so composing them into the graph needs the cast.
  return jsonLdGraph([organization, website, software, logo] as JsonLdNode[]);
}

export interface BreadcrumbTrailItem {
  /** Locale-agnostic pathname, as `absoluteLocalizedUrl` accepts. */
  pathname: string;
  name: string;
}

interface PageGraphOptions {
  locale: Locale;
  /** Locale-agnostic pathname of this page. */
  pathname: string;
  name: string;
  description?: string;
  /** Extra `@type`s beside `WebPage`: `FAQPage` for a question list, `CollectionPage` for an index. */
  pageTypes?: readonly ExtraPageType[];
  /** Trail below Home, in order. Home is prepended; this page is appended. Omit for the home page. */
  trail?: readonly BreadcrumbTrailItem[];
  datePublished?: Date;
  dateModified?: Date;
  primaryImageUrl?: string;
  /** The subject of the page. Defaults to the software entity; an index of one topic overrides it. */
  about?: JsonLdReference | readonly JsonLdReference[];
  /** The thing this page is primarily about, by `@id` or as an inline node. */
  mainEntity?: JsonLdNode | JsonLdReference | readonly (JsonLdNode | JsonLdReference)[];
  /** Nodes that live beside the page node in the same graph (a `BlogPosting`, a `TechArticle`). */
  nodes?: readonly JsonLdNode[];
}

/**
 * Binds every page to the site-wide nodes by `@id`; without that a crawler sees one anonymous entity per URL.
 */
export async function buildPageGraph({
  locale,
  pathname,
  name,
  description,
  pageTypes = [],
  trail = [],
  datePublished,
  dateModified,
  primaryImageUrl,
  about = { "@id": SOFTWARE_SCHEMA_ID },
  mainEntity,
  nodes = [],
}: PageGraphOptions): Promise<JsonLdGraph> {
  const tCrumb = await getTranslator({ locale, namespace: "Breadcrumb" });
  const url = absoluteLocalizedUrl({ pathname, locale });
  const isHome = pathname === "/";

  const crumbs: BreadcrumbTrailItem[] = [
    { pathname: "/", name: tCrumb("home") },
    ...trail,
    ...(isHome ? [] : [{ pathname, name }]),
  ];

  const breadcrumb: JsonLdNode = {
    "@type": "BreadcrumbList",
    "@id": breadcrumbSchemaId(url),
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absoluteLocalizedUrl({ pathname: crumb.pathname, locale }),
    })),
  };

  const page: JsonLdNode = {
    "@type": pageTypes.length > 0 ? ["WebPage", ...pageTypes] : "WebPage",
    "@id": pageSchemaId(url),
    url,
    name,
    ...(description && { description }),
    inLanguage: locale,
    isPartOf: { "@id": WEBSITE_SCHEMA_ID },
    about,
    breadcrumb: { "@id": breadcrumbSchemaId(url) },
    ...(datePublished && { datePublished: datePublished.toISOString() }),
    ...(dateModified && { dateModified: dateModified.toISOString() }),
    ...(primaryImageUrl && { primaryImageOfPage: { "@type": "ImageObject", url: primaryImageUrl } }),
    ...(mainEntity && { mainEntity }),
  };

  return jsonLdGraph([page, breadcrumb, ...nodes]);
}
