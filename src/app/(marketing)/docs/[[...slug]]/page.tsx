import { type Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import type { Route } from "next";
import type { JSONContent } from "@tiptap/core";

import { CopyDocsMarkdownButton } from "@/app/(marketing)/docs/_components/copy-docs-markdown-button";
import { DocsArticleBody } from "@/app/(marketing)/docs/_components/docs-article-body";
import { DocsOnThisPageNav } from "@/app/(marketing)/docs/_components/docs-on-this-page-nav";
import { SITE_URL } from "@/constants";
import {
  buildAbsoluteCmsEntryMarkdownUrl,
  buildCmsResolvedPath,
} from "@/lib/cms/cms-paths";
import { DOCS_SLUG } from "@/lib/cms/docs-config";
import { buildTableOfContentsTree } from "@/lib/cms/table-of-contents-tree";
import { extractTableOfContents } from "@/lib/cms/extract-table-of-contents";
import {
  getCmsNavigationAncestors,
  getCmsNavigationNodeByResolvedPath,
  getCmsNavigationPrevNext,
  getCmsNavigationRedirectByPath,
  getCmsNavigationRootPath,
  getCmsNavigationTree,
  type CmsNavigationTreeNode,
} from "@/lib/cms/cms-navigation-repository";
import { renderContentToMarkdown } from "@/lib/cms/render-content-to-markdown";
import { getCmsNavigationConfig } from "@/lib/cms/cms-navigation-config";
import { CMS_NAVIGATION_NODE_TYPES } from "@/types/cms-navigation";

interface DocsPageProps {
  params: Promise<{
    slug?: string[];
  }>;
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

async function resolveDocsPage(slugParts?: string[]) {
  const docsNavigation = getCmsNavigationConfig(DOCS_SLUG);

  if (!slugParts || slugParts.length === 0) {
    const rootPath = await getCmsNavigationRootPath({
      navigationKey: DOCS_SLUG,
    });

    if (!rootPath) {
      return {
        type: "not-found" as const,
      };
    }

    return {
      type: "redirect" as const,
      path: rootPath,
      permanent: false,
    };
  }

  const navigationTree = await getCmsNavigationTree({
    navigationKey: DOCS_SLUG,
  });
  const resolvedPath = buildCmsResolvedPath({
    basePath: docsNavigation.basePath,
    segments: slugParts,
  });
  const node = getCmsNavigationNodeByResolvedPath({
    path: resolvedPath,
    nodes: navigationTree,
  });

  if (!node) {
    const routeRedirect = await getCmsNavigationRedirectByPath({
      navigationKey: DOCS_SLUG,
      path: resolvedPath,
    });

    if (routeRedirect) {
      return {
        type: "redirect" as const,
        path: routeRedirect.toPath,
        permanent: routeRedirect.statusCode === 301,
      };
    }

    return {
      type: "not-found" as const,
    };
  }

  if (node.nodeType === CMS_NAVIGATION_NODE_TYPES.GROUP) {
    return {
      type: "group" as const,
      node,
      navigationTree,
    };
  }

  if (!node.entry) {
    return {
      type: "not-found" as const,
    };
  }

  return {
    type: "page" as const,
    node,
    navigationTree,
  };
}

export async function generateMetadata({
  params,
}: DocsPageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await resolveDocsPage(slug);
  const docsNavigation = getCmsNavigationConfig(DOCS_SLUG);

  if (result.type === "group") {
    const canonicalPath = result.node.resolvedPath ?? docsNavigation.basePath;
    const groupChildren = getRoutableGroupChildren(result.node);
    const childTitles = groupChildren.map((child) => child.title);
    const previewTitles = childTitles.slice(0, 3).join(", ");
    const description = previewTitles
      ? `${result.node.title} docs: ${previewTitles}${childTitles.length > 3 ? ", and more" : ""}.`
      : `Browse documentation in ${result.node.title}.`;

    return {
      title: result.node.title,
      description,
      keywords: childTitles,
      alternates: {
        canonical: canonicalPath,
      },
      openGraph: {
        title: result.node.title,
        description,
        url: canonicalPath,
        type: "website",
      },
      twitter: {
        card: "summary",
        title: result.node.title,
        description,
      },
    };
  }

  if (result.type !== "page") {
    return {
      title: "Docs",
    };
  }

  const { node } = result;
  const entry = node.entry!;
  const description =
    entry.seoDescription || `Documentation for ${entry.title}`;
  const canonicalPath = node.resolvedPath ?? docsNavigation.basePath;
  const featuredImageUrl = entry.featuredImageUrl
    ? `${SITE_URL}${entry.featuredImageUrl}`
    : undefined;

  return {
    title: entry.title,
    description,
    alternates: {
      canonical: canonicalPath,
    },
    openGraph: {
      title: entry.title,
      description,
      url: canonicalPath,
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
  const { slug } = await params;
  const result = await resolveDocsPage(slug);
  const docsNavigation = getCmsNavigationConfig(DOCS_SLUG);
  const docsBasePath = docsNavigation.basePath;

  if (result.type === "redirect") {
    if (result.permanent) {
      permanentRedirect(result.path);
    }

    redirect(result.path);
  }

  if (result.type === "not-found") {
    notFound();
  }

  const { node, navigationTree } = result;
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
        name: "Home",
        item: SITE_URL,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Docs",
        item: `${SITE_URL}${docsBasePath}`,
      },
      ...breadcrumbs.map((crumb, index) => ({
        "@type": "ListItem",
        position: index + 3,
        name: crumb.title,
        item: `${SITE_URL}${crumb.resolvedPath ?? docsBasePath}`,
      })),
      {
        "@type": "ListItem",
        position: breadcrumbs.length + 3,
        name: node.title,
        item: `${SITE_URL}${node.resolvedPath ?? docsBasePath}`,
      },
    ],
  };
  const breadcrumbNode = (
    <nav className="mb-6 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <Link href={docsBasePath as Route}>Docs</Link>
      {breadcrumbs.map((crumb) => (
        <div key={crumb.id} className="flex items-center gap-2">
          <span>/</span>
          {crumb.resolvedPath ? (
            <Link href={crumb.resolvedPath as Route}>{crumb.title}</Link>
          ) : (
            <span>{crumb.title}</span>
          )}
        </div>
      ))}
      <div className="flex items-center gap-2">
        <span>/</span>
        <span className="text-foreground">{node.title}</span>
      </div>
    </nav>
  );

  if (result.type === "group") {
    const children = getRoutableGroupChildren(node);
    const groupItemListJsonLd = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: `${node.title} documentation`,
      itemListElement: children.map((child, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: child.title,
        url: `${SITE_URL}${child.resolvedPath}`,
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
              <h1 className="mt-3 text-4xl font-semibold tracking-tight">{node.title}</h1>
              <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
                Browse pages in this section.
              </p>
            </header>

            {children.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {children.map((child) => {
                  const description = getNavigationItemDescription(child);

                  return (
                    <Link
                      key={child.id}
                      href={child.resolvedPath as Route}
                      className="rounded-xl border p-4 transition-colors hover:bg-muted/50"
                    >
                      <p className="font-medium">{child.title}</p>
                      {description ? (
                        <p className="mt-2 text-sm text-muted-foreground">
                          {description}
                        </p>
                      ) : null}
                      {child.nodeType === CMS_NAVIGATION_NODE_TYPES.GROUP ? (
                        <p className="mt-2 text-sm text-muted-foreground">
                          Section
                        </p>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            ) : (
              <p className="text-muted-foreground">
                No public child pages are available in this section yet.
              </p>
            )}
          </article>
        </div>
      </>
    );
  }

  const entry = node.entry!;
  const tableOfContents = extractTableOfContents(entry.content as JSONContent);
  const tableOfContentsTree = buildTableOfContentsTree(tableOfContents);
  const { previous, next } = getCmsNavigationPrevNext({
    currentNodeId: node.id,
    nodes: navigationTree,
  });
  const markdown = renderContentToMarkdown(entry.content as JSONContent);
  const markdownPath = buildAbsoluteCmsEntryMarkdownUrl({
    collectionSlug: entry.collection,
    slug: entry.slug,
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
                    downloadUrl={markdownPath}
                    markdown={markdown}
                  />
                </div>
              </div>
            </header>

            <DocsArticleBody
              content={entry.content as JSONContent}
              tableOfContents={tableOfContents}
            />

            {(previous || next) ? (
              <div className="mt-12 grid gap-4 border-t pt-8 md:grid-cols-2">
                {previous ? (
                  <Link
                    href={(previous.resolvedPath ?? docsBasePath) as Route}
                    className="rounded-xl border p-4 transition-colors hover:bg-muted/50"
                  >
                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      Previous
                    </p>
                    <p className="mt-2 font-medium">{previous.title}</p>
                  </Link>
                ) : (
                  <div />
                )}
                {next ? (
                  <Link
                    href={(next.resolvedPath ?? docsBasePath) as Route}
                    className="rounded-xl border p-4 text-left transition-colors hover:bg-muted/50"
                  >
                    <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      Next
                    </p>
                    <p className="mt-2 font-medium">{next.title}</p>
                  </Link>
                ) : null}
              </div>
            ) : null}
          </article>

          {tableOfContents.length > 0 ? (
            <aside className="hidden xl:block">
              <div className="sticky top-24">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  On This Page
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
