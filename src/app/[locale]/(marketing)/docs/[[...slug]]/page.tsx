import { type Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import type { Route } from "next";
import type { JSONContent } from "@tiptap/core";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { CopyDocsMarkdownButton } from "@/app/[locale]/(marketing)/docs/_components/copy-docs-markdown-button";
import { DocsArticleBody } from "@/app/[locale]/(marketing)/docs/_components/docs-article-body";
import { DocsOnThisPageNav } from "@/app/[locale]/(marketing)/docs/_components/docs-on-this-page-nav";
import { SITE_URL } from "@/constants";
import {
  buildAbsoluteCmsEntryMarkdownUrl,
  buildCmsEntryMarkdownPath,
} from "@/lib/cms/cms-paths";
import { getCachedDocsEntryArtifacts } from "@/lib/cms/docs-entry-artifacts";
import { DOCS_SLUG } from "@/lib/cms/docs-config";
import { getEntryLocales } from "@/lib/cms/entry";
import {
  getCmsNavigationAncestors,
  getCmsNavigationNodeByResolvedPath,
  getCmsNavigationPrevNext,
  getCmsNavigationRedirectByPath,
  getCmsNavigationRootPath,
  getCmsNavigationTree,
  type CmsNavigationTreeNode,
} from "@/lib/cms/cms-navigation-repository";
import { getCmsNavigationConfig } from "@/lib/cms/cms-navigation-config";
import { resolveDocsPage } from "@/lib/cms/resolve-docs-page";
import { cn } from "@/lib/utils";
import { CMS_NAVIGATION_NODE_TYPES, getNavigationNodeDisplayTitle } from "@/types/cms-navigation";
import { DEFAULT_LOCALE, getOpenGraphLocales, isLocale, LOCALES, type Locale } from "@/i18n/config";
import { Link, permanentRedirect, redirect } from "@/i18n/navigation";
import { buildAlternates, noindexNonDefaultLocale } from "@/utils/i18n-metadata";
import { absoluteLocalizedUrl } from "@/utils/i18n-urls";

interface DocsPageProps {
  params: Promise<{
    locale: Locale;
    slug?: string[];
  }>;
}

function getDocsSlugCacheKey(slugParts?: string[]): string {
  return JSON.stringify(slugParts ?? []);
}

function getRoutableGroupChildren(node: CmsNavigationTreeNode): CmsNavigationTreeNode[] {
  return node.children.filter(
    (child): child is CmsNavigationTreeNode => typeof child.resolvedPath === "string"
  );
}

function getNavigationItemDescription(node: CmsNavigationTreeNode): string | null {
  if (!node.entry) {
    return null;
  }

  return node.entry.seoDescription || null;
}

// Wires the pure `resolveDocsPage` resolver to the CMS navigation repository,
// kept out of the resolver module so it stays free of the repository's
// top-level `getDB`/drizzle import.
async function resolveCurrentDocsPage(slugParts: string[] | undefined, locale: Locale) {
  const docsNavigation = getCmsNavigationConfig(DOCS_SLUG);

  return resolveDocsPage({
    slugParts,
    locale,
    defaultLocale: DEFAULT_LOCALE,
    docsBasePath: docsNavigation.basePath,
    getNavigationTree: ({ locale: treeLocale }) =>
      getCmsNavigationTree({ navigationKey: DOCS_SLUG, locale: treeLocale }),
    getNavigationRedirectByPath: ({ path }) =>
      getCmsNavigationRedirectByPath({ navigationKey: DOCS_SLUG, path }),
    getNavigationRootPath: () => getCmsNavigationRootPath({ navigationKey: DOCS_SLUG }),
    getNodeByResolvedPath: getCmsNavigationNodeByResolvedPath,
  });
}

const resolveCachedDocsPage = cache(async (slugCacheKey: string, locale: Locale) => {
  const slugParts = JSON.parse(slugCacheKey) as string[];
  return resolveCurrentDocsPage(slugParts.length > 0 ? slugParts : undefined, locale);
});

export async function generateMetadata({
  params,
}: DocsPageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  const tMeta = await getTranslations({ locale, namespace: "Client.Docs.meta" });
  const result = await resolveCachedDocsPage(getDocsSlugCacheKey(slug), locale);
  const docsNavigation = getCmsNavigationConfig(DOCS_SLUG);

  if (result.type === "markdown-redirect") {
    redirect({
      href: buildCmsEntryMarkdownPath({
        collectionSlug: result.collectionSlug,
        slug: result.slug,
      }) as Route,
      locale,
    });
  }

  if (result.type === "redirect") {
    // CMS-configured redirects (renamed slugs, root path, etc.) must keep the
    // active locale prefix rather than dropping it (see module-level comment).
    redirect({ href: result.path as Route, locale });
  }

  if (result.type === "group") {
    const groupTitle = getNavigationNodeDisplayTitle(result.node);
    const canonicalPath = result.node.resolvedPath ?? docsNavigation.basePath;
    const groupChildren = getRoutableGroupChildren(result.node);
    const childTitles = groupChildren.map((child) => getNavigationNodeDisplayTitle(child));
    const previewTitles = childTitles.slice(0, 3).join(", ");
    const previews = `${previewTitles}${childTitles.length > 3 ? tMeta("andMore") : ""}`;
    const description = previewTitles
      ? tMeta("groupDescriptionWithPreview", { group: groupTitle, previews })
      : tMeta("groupDescription", { group: groupTitle });

    return {
      title: groupTitle,
      description,
      keywords: childTitles,
      alternates: buildAlternates({ pathname: canonicalPath, locale, availableLocales: LOCALES }),
      openGraph: {
        ...getOpenGraphLocales(locale),
        title: groupTitle,
        description,
        url: absoluteLocalizedUrl({ pathname: canonicalPath, locale }),
        type: "website",
      },
      twitter: {
        card: "summary",
        title: groupTitle,
        description,
      },
    };
  }

  if (result.type !== "page") {
    return {
      title: tMeta("fallbackTitle"),
    };
  }

  const { node, isFallback } = result;
  const entry = node.entry!;
  const description =
    entry.seoDescription || tMeta("pageDescription", { title: entry.title });
  const canonicalPath = node.resolvedPath ?? docsNavigation.basePath;
  const featuredImageUrl = entry.featuredImageUrl
    ? `${SITE_URL}${entry.featuredImageUrl}`
    : undefined;
  const availableLocales = await getEntryLocales({
    collectionSlug: entry.collection,
    slug: entry.slug,
  });

  // A fallback render serves default-locale content under a non-default-locale
  // prefix (noindexed, mixed-language), so it canonicalizes to the real
  // default-locale URL; hreflang still lists only genuine translations.
  const urlLocale = isFallback ? DEFAULT_LOCALE : locale;
  const alternates = buildAlternates({
    pathname: canonicalPath,
    locale: urlLocale,
    availableLocales: availableLocales.filter(isLocale),
  });

  return {
    title: entry.title,
    description,
    ...(isFallback ? noindexNonDefaultLocale(locale) : {}),
    alternates,
    openGraph: {
      ...getOpenGraphLocales(urlLocale),
      title: entry.title,
      description,
      url: absoluteLocalizedUrl({ pathname: canonicalPath, locale: urlLocale }),
      type: "article",
      ...(featuredImageUrl
        ? {
            images: [
              {
                url: featuredImageUrl,
                alt: entry.featuredImage?.alt || entry.title,
              },
            ],
          }
        : {}),
    },
    twitter: {
      card: featuredImageUrl ? "summary_large_image" : "summary",
      title: entry.title,
      description,
      ...(featuredImageUrl ? { images: [featuredImageUrl] } : {}),
    },
  };
}

export default async function DocsPage({ params }: DocsPageProps) {
  const t = await getTranslations("Client.Docs.Page");
  const tPagination = await getTranslations("Client.Pagination");
  const tCrumb = await getTranslations("Breadcrumb");
  const { locale, slug } = await params;
  const result = await resolveCachedDocsPage(getDocsSlugCacheKey(slug), locale);
  const docsNavigation = getCmsNavigationConfig(DOCS_SLUG);
  const docsBasePath = docsNavigation.basePath;

  if (result.type === "markdown-redirect") {
    redirect({
      href: buildCmsEntryMarkdownPath({
        collectionSlug: result.collectionSlug,
        slug: result.slug,
      }) as Route,
      locale,
    });
  }

  if (result.type === "redirect") {
    // CMS-configured redirects (renamed slugs, root path, etc.) must keep the
    // active locale prefix rather than dropping it (see module-level comment).
    if (result.permanent) {
      permanentRedirect({ href: result.path as Route, locale });
    }

    redirect({ href: result.path as Route, locale });
  }

  if (result.type === "not-found") {
    notFound();
  }

  const { node, navigationTree } = result;
  const urlLocale = result.type === "page" && result.isFallback ? DEFAULT_LOCALE : locale;
  const nodeTitle = getNavigationNodeDisplayTitle(node);
  const breadcrumbs = getCmsNavigationAncestors({
    nodeId: node.id,
    nodes: navigationTree,
  });
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: tCrumb("home"),
        item: absoluteLocalizedUrl({ pathname: "/", locale: urlLocale }),
      },
      {
        "@type": "ListItem",
        position: 2,
        name: t("docs"),
        item: absoluteLocalizedUrl({ pathname: docsBasePath, locale: urlLocale }),
      },
      ...breadcrumbs.map((crumb, index) => ({
        "@type": "ListItem",
        position: index + 3,
        name: getNavigationNodeDisplayTitle(crumb),
        item: absoluteLocalizedUrl({
          pathname: crumb.resolvedPath ?? docsBasePath,
          locale: urlLocale,
        }),
      })),
      {
        "@type": "ListItem",
        position: breadcrumbs.length + 3,
        name: nodeTitle,
        item: absoluteLocalizedUrl({
          pathname: node.resolvedPath ?? docsBasePath,
          locale: urlLocale,
        }),
      },
    ],
  };
  const breadcrumbNode = (
    <nav className="mb-6 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <Link href={docsBasePath}>{t("docs")}</Link>
      {breadcrumbs.map((crumb) => (
        <div key={crumb.id} className="flex items-center gap-2">
          <span>/</span>
          {crumb.resolvedPath ? (
            <Link href={crumb.resolvedPath}>{getNavigationNodeDisplayTitle(crumb)}</Link>
          ) : (
            <span>{getNavigationNodeDisplayTitle(crumb)}</span>
          )}
        </div>
      ))}
      <div className="flex items-center gap-2">
        <span>/</span>
        <span className="text-foreground">{nodeTitle}</span>
      </div>
    </nav>
  );

  if (result.type === "group") {
    const children = getRoutableGroupChildren(node);
    const groupItemListJsonLd = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: t("groupListName", { group: nodeTitle }),
      itemListElement: children.map((child, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: getNavigationNodeDisplayTitle(child),
        url: absoluteLocalizedUrl({ pathname: child.resolvedPath!, locale: urlLocale }),
        description: getNavigationItemDescription(child) ?? undefined,
      })),
    };

    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
        />
        {children.length > 0 ? (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(groupItemListJsonLd) }}
          />
        ) : null}
        <div className="px-4 py-10 lg:px-8">
          <article className="min-w-0">
            {breadcrumbNode}

            <header className="mb-8 border-b pb-6">
              <h1 className="mt-3 text-4xl font-semibold tracking-tight">{nodeTitle}</h1>
              <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
                {t("sectionFallbackDescription")}
              </p>
            </header>

            {children.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {children.map((child) => {
                  const description = getNavigationItemDescription(child);
                  const childTitle = getNavigationNodeDisplayTitle(child);

                  return (
                    <Link
                      key={child.id}
                      href={child.resolvedPath as Route}
                      className="rounded-xl border p-4 transition-colors hover:bg-muted/50"
                    >
                      <p className="font-medium">{childTitle}</p>
                      {description ? (
                        <p className="mt-2 text-sm text-muted-foreground">
                          {description}
                        </p>
                      ) : null}
                      {child.nodeType === CMS_NAVIGATION_NODE_TYPES.GROUP ? (
                        <p className="mt-2 text-sm text-muted-foreground">
                          {t("section")}
                        </p>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="text-muted-foreground">
                {t("noChildPages")}
              </p>
            )}
          </article>
        </div>
      </>
    );
  }

  const entry = node.entry!;
  const artifacts = await getCachedDocsEntryArtifacts({
    collectionSlug: entry.collection,
    slug: entry.slug,
    // Use the resolved entry's own locale (not the URL locale) so the TOC matches
    // the rendered body — including untranslated docs that fall back to DEFAULT_LOCALE.
    locale: isLocale(entry.locale) ? entry.locale : DEFAULT_LOCALE,
  });

  if (!artifacts) {
    notFound();
  }

  const {
    content: entryContent,
    markdown,
    tableOfContents,
    tableOfContentsTree,
  } = artifacts;
  const { previous, next } = getCmsNavigationPrevNext({
    currentNodeId: node.id,
    nodes: navigationTree,
  });
  const previousSeoDescription = previous
    ? getNavigationItemDescription(previous)
    : null;
  const nextSeoDescription = next ? getNavigationItemDescription(next) : null;
  const markdownApiUrl = buildAbsoluteCmsEntryMarkdownUrl({
    collectionSlug: entry.collection,
    slug: entry.slug,
  });
  const markdownDownloadUrl = buildAbsoluteCmsEntryMarkdownUrl({
    collectionSlug: entry.collection,
    slug: entry.slug,
    download: true,
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <div className="px-4 py-10 lg:px-8">
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_260px]">
          <article className="min-w-0">
            {breadcrumbNode}

            <header className="mb-10 border-b pb-8">
              <div className="mt-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                <h1 className="min-w-0 max-w-full text-4xl font-semibold tracking-tight">
                  {entry.title}
                </h1>
                <div className="shrink-0">
                  <CopyDocsMarkdownButton
                    downloadUrl={markdownDownloadUrl}
                    markdown={markdown}
                    rawMarkdownUrl={markdownApiUrl}
                  />
                </div>
              </div>
            </header>

            <DocsArticleBody
              content={entryContent as JSONContent}
              tableOfContents={tableOfContents}
            />

            {(previous || next) ? (
              <div className="mt-12 grid gap-4 pt-8 md:grid-cols-2">
                {previous ? (
                  <Link
                    href={(previous.resolvedPath ?? docsBasePath)}
                    className="group rounded-2xl border border-border/70 bg-card/60 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:bg-muted/40 hover:shadow-sm"
                  >
                    <div className="flex items-start gap-4">
                      <div className="mt-0.5 rounded-full border border-border/70 bg-background/80 p-2 text-muted-foreground transition-colors group-hover:text-foreground">
                        <ArrowLeft className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                          {tPagination("previous")}
                        </p>
                        <p className="mt-2 font-medium transition-colors group-hover:text-foreground">
                          {getNavigationNodeDisplayTitle(previous)}
                        </p>
                        {previousSeoDescription ? (
                          <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                            {previousSeoDescription}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </Link>
                ) : (
                  <div />
                )}
                {next ? (
                  <Link
                    href={(next.resolvedPath ?? docsBasePath)}
                    className={cn(
                      "group rounded-2xl border border-border/70 bg-card/60 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:bg-muted/40 hover:shadow-sm",
                      previous ? "text-left md:text-right" : "text-right md:col-start-2",
                    )}
                  >
                    <div
                      className={cn(
                        "flex items-start gap-4",
                        previous ? "md:flex-row-reverse" : "flex-row-reverse",
                      )}
                    >
                      <div className="mt-0.5 rounded-full border border-border/70 bg-background/80 p-2 text-muted-foreground transition-colors group-hover:text-foreground">
                        <ArrowRight className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                          {tPagination("next")}
                        </p>
                        <p className="mt-2 font-medium transition-colors group-hover:text-foreground">
                          {getNavigationNodeDisplayTitle(next)}
                        </p>
                        {nextSeoDescription ? (
                          <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                            {nextSeoDescription}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </Link>
                ) : null}
              </div>
            ) : null}
          </article>

          {tableOfContents.length > 0 ? (
            <aside className="hidden xl:block">
              <div className="sticky top-10 max-h-[calc(100vh-5rem)]">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  {t("onThisPage")}
                </p>
                <DocsOnThisPageNav nodes={tableOfContentsTree} />
              </div>
            </aside>
          ) : null}
        </div>
      </div>
    </>
  );
}
