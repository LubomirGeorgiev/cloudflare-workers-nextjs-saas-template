/**
 * Which requests are for a generated OpenGraph card.
 *
 * Import-free and pure: `worker-entrypoint.ts` reaches this on every request, so it sits on the startup
 * graph (see docs/worker-hot-path-and-bundle-size.md and tools/startup-import-closure.test.ts).
 */

// Next.js serves these as `<segment>/opengraph-image` plus a per-route dedup suffix
// (`opengraph-image-v2by4x`). The suffix is a 6-character base36 hash — see `getMetadataRouteSuffix`
// in `next/dist/lib/metadata/get-metadata-route`. `twitter-image` is listed because the same file
// convention produces it, even though the template ships none today. No extension arm: the pattern
// is anchored, so a dotted last segment such as `opengraph-image.png` never matches.
const OG_IMAGE_SEGMENT_PATTERN = /^(?:opengraph|twitter)-image(?:-[0-9a-z]{6})?$/i

export function isOgImageRequest({
  pathname,
  headers,
}: {
  pathname: string
  headers: Headers
}): boolean {
  return isOgImagePathname(pathname) && !isPageRequest(headers)
}

// The segment alone cannot prove the URL is a card: a post slug can wear it too, and `launch` is as
// valid a dedup hash as `v2by4x`. Nothing in the path separates the two, so let the client do it.
function isOgImagePathname(pathname: string): boolean {
  return OG_IMAGE_SEGMENT_PATTERN.test(pathname.slice(pathname.lastIndexOf("/") + 1))
}

// A card is fetched by a crawler or an `<img>`, never navigated to. Every browser asks for
// `text/html` on a document navigation and sets `RSC` on a client-side one, so a page that happens
// to wear a card's segment keeps its Set-Cookie.
function isPageRequest(headers: Headers): boolean {
  return headers.has("rsc") || (headers.get("accept") ?? "").includes("text/html")
}
