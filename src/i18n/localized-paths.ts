// Which pathnames next-intl is allowed to rewrite. This lives in code rather than in
// `proxy.ts`'s `config.matcher` because Next requires that matcher to be statically
// analyzable — nothing can be imported into it, shared with it, or tested against it.

// Top-level URL segments served outside `app/[locale]`. Anything here must reach its
// route untouched; a locale rewrite would 404 it. Paths a Worker handler intercepts
// before Next (`/mcp`, `/api/v1`) never reach the proxy and do not belong here.
export const NON_LOCALIZED_PATH_SEGMENTS = ["api", "llms.txt", "markdown"] as const;

// Segments serving both localized pages and root-level routes (`/docs/*` pages under
// `[locale]`, `/docs/llms.txt` at the app root). They must stay out of the list above;
// the dotted-segment rule below is what separates the two halves.
export const MIXED_LOCALIZATION_PATH_SEGMENTS = ["docs"] as const;

// A dotted final segment means a static asset or a machine endpoint (`/robots.txt`,
// `/sitemap.xml`, `/docs/llms.txt`) — never a localized page. The Worker handles
// `.md` page requests before they can reach this function.

export function shouldLocalizePathname(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  const firstSegment = segments[0];

  if (firstSegment && (NON_LOCALIZED_PATH_SEGMENTS as readonly string[]).includes(firstSegment)) {
    return false;
  }

  if (segments.some((segment) => segment.includes("."))) {
    return false;
  }

  return true;
}
