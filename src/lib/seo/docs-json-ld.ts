import "server-only";

import type { Locale } from "@/i18n/config";
import { getTranslator } from "@/i18n/translator";
import { getCmsNavigationConfig } from "@/lib/cms/cms-navigation-config";
import { DOCS_SLUG } from "@/lib/cms/docs-config";
import { absoluteLocalizedUrl } from "@/utils/i18n-urls";
import {
  buildPageGraph,
  ORGANIZATION_SCHEMA_ID,
  pageSchemaId,
  SOFTWARE_SCHEMA_ID,
  WEBSITE_SCHEMA_ID,
  type BreadcrumbTrailItem,
} from "./json-ld";

interface DocsGraphOptions {
  locale: Locale;
  /** Locale-agnostic pathname of the documentation page. */
  pathname: string;
  name: string;
  description: string;
  /** Crumbs between the docs root and this page; the root and this page are added here. */
  trail?: readonly BreadcrumbTrailItem[];
}

interface DocsArticleGraphOptions extends DocsGraphOptions {
  /** Headings of the rendered body, in order. */
  sections?: readonly string[];
  /** Plain-text rendering of this page, for an agent that should not have to scrape the HTML. */
  markdownUrl?: string;
}

/** A page a section links to, as the section itself lists it. */
interface DocsCollectionItem {
  /** Locale-agnostic pathname of the linked page. */
  pathname: string;
  name: string;
  description?: string;
}

interface DocsCollectionGraphOptions extends DocsGraphOptions {
  /** Pages of this section, in the order the page lists them. */
  items?: readonly DocsCollectionItem[];
}

// The docs root is a crumb every docs page carries, so a caller states only what sits below it.
// The root itself comes from the CMS navigation, which can move it.
function docsTrail({
  rootName,
  trail,
}: {
  rootName: string;
  trail: readonly BreadcrumbTrailItem[];
}): BreadcrumbTrailItem[] {
  return [
    { pathname: getCmsNavigationConfig(DOCS_SLUG).basePath, name: rootName },
    ...trail,
  ];
}

/**
 * `TechArticle` rather than `Article`: schema.org's type for documentation, what answer engines read.
 */
export async function buildDocsArticleGraph({
  locale,
  pathname,
  name,
  description,
  trail = [],
  sections = [],
  markdownUrl,
}: DocsArticleGraphOptions) {
  const t = await getTranslator({ locale, namespace: "Client.Docs.Page" });
  const url = absoluteLocalizedUrl({ pathname, locale });
  const articleId = `${url}#article`;

  return buildPageGraph({
    locale,
    pathname,
    name,
    description,
    trail: docsTrail({ rootName: t("docs"), trail }),
    mainEntity: { "@id": articleId },
    nodes: [
      {
        "@type": "TechArticle",
        "@id": articleId,
        headline: name,
        description,
        url,
        inLanguage: locale,
        mainEntityOfPage: { "@id": pageSchemaId(url) },
        isPartOf: { "@id": WEBSITE_SCHEMA_ID },
        publisher: { "@id": ORGANIZATION_SCHEMA_ID },
        about: { "@id": SOFTWARE_SCHEMA_ID },
        ...(sections.length > 0 && { articleSection: [...sections] }),
        ...(markdownUrl && {
          encoding: {
            "@type": "MediaObject",
            encodingFormat: "text/markdown",
            contentUrl: markdownUrl,
          },
        }),
      },
    ],
  });
}

/**
 * Takes the same trail as `buildDocsArticleGraph` — crumbs below the docs root — so a route builds one.
 */
export async function buildDocsCollectionGraph({
  locale,
  pathname,
  name,
  description,
  trail = [],
  items = [],
}: DocsCollectionGraphOptions) {
  const t = await getTranslator({ locale, namespace: "Client.Docs.Page" });

  return buildPageGraph({
    locale,
    pathname,
    name,
    description,
    pageTypes: ["CollectionPage"],
    trail: docsTrail({ rootName: t("docs"), trail }),
    ...(items.length > 0 && {
      mainEntity: {
        "@type": "ItemList",
        name: t("groupListName", { group: name }),
        numberOfItems: items.length,
        itemListElement: items.map((item, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: item.name,
          url: absoluteLocalizedUrl({ pathname: item.pathname, locale }),
          ...(item.description && { description: item.description }),
        })),
      },
    }),
  });
}
