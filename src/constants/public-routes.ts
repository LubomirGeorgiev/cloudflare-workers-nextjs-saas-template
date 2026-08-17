import type { TranslatorNamespace } from "@/i18n/translator";

// Public JSX pages that do not depend on a dynamic route parameter. The sitemap and the Markdown
// page allowlist share this list, so a new public page becomes visible to both surfaces together.
export const STATIC_PUBLIC_ROUTES = [
  {
    pathname: "/",
    changeFrequency: "daily",
    priority: 1,
    metaNamespace: "Landing.meta",
  },
  {
    pathname: "/privacy",
    changeFrequency: "monthly",
    priority: 0.3,
    metaNamespace: "Legal.Privacy.meta",
  },
  {
    pathname: "/terms",
    changeFrequency: "monthly",
    priority: 0.3,
    metaNamespace: "Legal.Terms.meta",
  },
] as const satisfies ReadonlyArray<{
  pathname: string;
  changeFrequency: "daily" | "monthly";
  priority: number;
  metaNamespace: TranslatorNamespace;
}>;

// Public blog listing pages. The sitemap, Markdown allowlist, and llms.txt share this list.
export const BLOG_LISTING_ROUTES = [
  {
    pathname: "/blog",
    changeFrequency: "daily",
    priority: 0.8,
    metaNamespace: "Blog.ListPage.meta",
  },
  {
    pathname: "/blog/tags",
    changeFrequency: "weekly",
    priority: 0.6,
    metaNamespace: "Blog.Tags.meta",
  },
  {
    pathname: "/blog/authors",
    changeFrequency: "weekly",
    priority: 0.6,
    metaNamespace: "Blog.Authors.meta",
  },
] as const satisfies ReadonlyArray<{
  pathname: string;
  changeFrequency: "daily" | "weekly";
  priority: number;
  metaNamespace: TranslatorNamespace;
}>;

// Public blog pages whose last segment is a route parameter, so no list can name them. They belong
// to this route table, not to a Markdown-only allowlist: a fork that adds a facet page adds it here
// once, and the sitemap and the `.md` surface both follow.
export const DYNAMIC_BLOG_PAGE_PATTERNS = [
  /^\/blog\/\d+$/,
  /^\/blog\/tags\/[^/]+$/,
  /^\/blog\/authors\/[^/]+$/,
] as const;
