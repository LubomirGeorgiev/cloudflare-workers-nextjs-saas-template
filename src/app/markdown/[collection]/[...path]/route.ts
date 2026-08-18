import { NextResponse } from "next/server";

import { cmsConfig, isCollectionSlug, type CollectionsUnion } from "@/../cms.config";
import { CMS_ENTRY_STATUS } from "@/app/enums";
import { CMS_MARKDOWN_CACHE_CONTROL } from "@/constants/cache-control";
import { buildCmsEntryMarkdown } from "@/lib/cms/build-cms-entry-markdown-response";
import {
  getCmsNavigationNodeByResolvedPath,
  getCmsNavigationRedirectByPath,
  getCmsNavigationTree,
} from "@/lib/cms/cms-navigation-repository";
import { DOCS_BASE_PATH, DOCS_SLUG } from "@/lib/cms/docs-config";
import { getCmsEntryBySlug } from "@/lib/cms/entry";
import { resolveDocsPage } from "@/lib/cms/resolve-docs-page";
import { markdownDownloadDisposition } from "@/lib/markdown-pages/download-filename";
import { buildMarkdownPagePath } from "@/lib/markdown-pages/page-paths";
import { actionErrorToProblem, toProblemResponse } from "@/lib/api/errors";
import { applyRateLimitHeaders } from "@/lib/api/rate-limit-headers";
import { CACHE_TAGS, setCacheScope } from "@/utils/cache";
import { absoluteLocalizedUrl, localizedPathname } from "@/utils/i18n-urls";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import { consumeRateLimit, RATE_LIMITS, RateLimitError } from "@/utils/with-rate-limit";

interface CachedMarkdownEntry {
  collection: string;
  markdown: string;
  slug: string;
}

type DocsPathResolution =
  | { type: "entry"; pathname: string; slug: string }
  | { type: "redirect"; pathname: string; status: 301 | 302 }
  | { type: "not-found" };

/** `no-navigation` is the one docs answer that leaves the bare entry slug worth trying. */
type DocsNavigationResolution = DocsPathResolution | { type: "no-navigation" };

const DOCS_RESOLUTION_CACHE_TAGS = [
  CACHE_TAGS.cmsNavigation(DOCS_SLUG),
  CACHE_TAGS.cmsRedirect(DOCS_SLUG),
];

function entryCacheTags({
  collectionSlug,
  slug,
}: {
  collectionSlug: string;
  slug: string;
}): string[] {
  return [CACHE_TAGS.cmsEntry({ collectionSlug, slug })];
}

export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      collection: string;
      path: string[];
    }>;
  },
) {
  try {
    // Charged because the caller picks the path here: a novel slug always misses, so it costs a D1
    // read and a cache write. The Worker's page branch is exempt; its paths are a fixed allowlist.
    const quota = await consumeRateLimit(RATE_LIMITS.CMS_MARKDOWN_API);
    const response = await handleMarkdownRouteRequest({ request, ...(await params) });
    applyRateLimitHeaders({ headers: response.headers, quota });
    return response;
  } catch (error) {
    if (error instanceof RateLimitError) {
      return toProblemResponse(actionErrorToProblem({ error, request }));
    }

    throw error;
  }
}

function notFoundResponse(error: string): NextResponse {
  return NextResponse.json({ error }, { status: 404 });
}

function renderedEntryResponse({
  cacheTags,
  entry,
  wantsDownload,
}: {
  cacheTags: string[];
  entry: CachedMarkdownEntry;
  wantsDownload: boolean;
}): Response {
  const headers: Record<string, string> = {
    "cache-control": CMS_MARKDOWN_CACHE_CONTROL,
    "cache-tag": cacheTags.join(","),
    "content-type": "text/markdown; charset=utf-8",
  };

  if (wantsDownload) {
    headers["content-disposition"] = markdownDownloadDisposition({
      subject: `${entry.collection}/${entry.slug}`,
    });
  }

  return new Response(entry.markdown, { headers });
}

async function handleMarkdownRouteRequest({
  request,
  collection,
  path,
}: {
  request: Request;
  collection: string;
  path: string[];
}): Promise<Response> {
  if (!isCollectionSlug(collection)) {
    return notFoundResponse("CMS collection not found");
  }

  const collectionSlug = collection;
  const requestUrl = new URL(request.url);
  const requestedLocale = requestUrl.searchParams.get("locale");
  const locale = requestedLocale && isLocale(requestedLocale) ? requestedLocale : DEFAULT_LOCALE;
  const resolution = await resolveMarkdownEntry({ collectionSlug, path });
  const wantsDownload = requestUrl.searchParams.has("download");

  if (resolution.type === "redirect") {
    // Built by hand because `Response.redirect` marks its headers immutable, and `GET` writes the
    // rate-limit headers onto this response afterwards. The location stays relative: an absolute one
    // resolves against the build-time `SITE_URL` and would send a preview deployment to production.
    return new Response(null, {
      status: resolution.status,
      headers: {
        location: buildMarkdownPagePath({
          pathname: localizedPathname({ pathname: resolution.pathname, locale }),
          download: wantsDownload,
        }),
      },
    });
  }

  if (resolution.type !== "entry") {
    return notFoundResponse("CMS entry not found");
  }

  const entry = await renderCachedEntryMarkdown({
    collectionSlug,
    locale,
    sourcePathname: resolution.pathname,
    slug: resolution.slug,
  });

  if (!entry) {
    return notFoundResponse("CMS entry not found");
  }

  // This route owns Cache-Control, so Vinext cannot attach the collected tags. Mirror the tags the
  // two cached functions declared, so the edge copy shares their invalidation contract. The docs
  // tags stay even on a `no-navigation` fall-through: the resolver declared them before it gave up.
  const cacheTags = [
    ...entryCacheTags({ collectionSlug, slug: resolution.slug }),
    ...(collectionSlug === DOCS_SLUG ? DOCS_RESOLUTION_CACHE_TAGS : []),
  ];

  return renderedEntryResponse({ cacheTags, entry, wantsDownload });
}

async function resolveMarkdownEntry({
  collectionSlug,
  path,
}: {
  collectionSlug: CollectionsUnion;
  path: string[];
}): Promise<DocsPathResolution> {
  if (collectionSlug === DOCS_SLUG) {
    const docsResolution = await resolveCachedDocsMarkdownPath({ path: path.join("/") });

    // The navigation tree is the authority once it exists: an unlisted docs entry stays a 404 here,
    // the same as it is for a reader.
    if (docsResolution.type !== "no-navigation") {
      return docsResolution;
    }
  }

  // No navigation tree claims this collection, so a single segment is tried as a bare entry slug.
  // This is the only path by which a blog entry resolves.
  if (path.length !== 1) {
    return { type: "not-found" };
  }

  const collection = cmsConfig.collections[collectionSlug];
  const previewUrl = "previewUrl" in collection ? collection.previewUrl : undefined;
  const slug = path[0]!;

  return {
    type: "entry",
    pathname: previewUrl ? previewUrl(slug) : `/${collectionSlug}/${slug}`,
    slug,
  };
}

async function resolveCachedDocsMarkdownPath({
  path,
}: {
  path: string;
}): Promise<DocsNavigationResolution> {
  "use cache: remote";
  setCacheScope({
    tags: DOCS_RESOLUTION_CACHE_TAGS,
    ttl: "8 hours",
  });

  // Docs paths are locale-invariant. Resolve them from the canonical tree, then load the requested
  // entry locale below, where a missing translation already falls back to the default entry.
  const navigationTree = await getCmsNavigationTree({
    navigationKey: DOCS_SLUG,
    locale: DEFAULT_LOCALE,
  });

  // `resolveDocsPage` sends an empty tree to the docs root redirect, which is not a Markdown
  // document. Report no claim instead, so the caller falls back to the bare entry slug.
  if (navigationTree.length === 0) {
    return { type: "no-navigation" };
  }

  const resolution = await resolveDocsPage({
    slugParts: path.split("/"),
    locale: DEFAULT_LOCALE,
    defaultLocale: DEFAULT_LOCALE,
    docsBasePath: DOCS_BASE_PATH,
    getNavigationTree: async () => navigationTree,
    getNavigationRedirectByPath: ({ path: redirectPath }) =>
      getCmsNavigationRedirectByPath({ navigationKey: DOCS_SLUG, path: redirectPath }),
    // Unreachable: a `[...path]` route always has one segment, so the root branch never runs.
    getNavigationRootPath: async () => null,
    getNodeByResolvedPath: getCmsNavigationNodeByResolvedPath,
  });

  if (resolution.type === "redirect") {
    return {
      type: "redirect",
      pathname: resolution.path,
      status: resolution.permanent ? 301 : 302,
    };
  }

  // A group node and an entry-less node are the same dead end here: neither has Markdown to serve.
  if (resolution.type !== "page") {
    return { type: "not-found" };
  }

  const { entry, resolvedPath } = resolution.node;

  return entry && resolvedPath
    ? { type: "entry", pathname: resolvedPath, slug: entry.slug }
    : { type: "not-found" };
}

async function renderCachedEntryMarkdown({
  collectionSlug,
  locale,
  sourcePathname,
  slug,
}: {
  collectionSlug: CollectionsUnion;
  locale: Locale;
  sourcePathname: string;
  slug: string;
}): Promise<CachedMarkdownEntry | null> {
  "use cache: remote";
  setCacheScope({
    tags: entryCacheTags({ collectionSlug, slug }),
    ttl: "8 hours",
  });

  const localizedEntry = await getCmsEntryBySlug({
    collectionSlug,
    includeRelations: { createdByUser: true, tags: true },
    locale,
    slug,
    status: CMS_ENTRY_STATUS.PUBLISHED,
  });
  const entry = localizedEntry ?? (locale === DEFAULT_LOCALE
    ? null
    : await getCmsEntryBySlug({
        collectionSlug,
        includeRelations: { createdByUser: true, tags: true },
        locale: DEFAULT_LOCALE,
        slug,
        status: CMS_ENTRY_STATUS.PUBLISHED,
      }));

  if (!entry) {
    return null;
  }

  return {
    collection: entry.collection,
    markdown: buildCmsEntryMarkdown({
      entry,
      sourceUrl: absoluteLocalizedUrl({
        pathname: sourcePathname,
        locale: isLocale(entry.locale) ? entry.locale : DEFAULT_LOCALE,
      }),
    }),
    slug: entry.slug,
  };
}
