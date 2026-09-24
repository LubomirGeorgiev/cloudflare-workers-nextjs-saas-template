/**
 * Which paths may name a generated OpenGraph card.
 *
 * Import-free and pure: the edge HTML cache gate calls it on every page request it considers.
 */

// Next.js serves these as `<segment>/opengraph-image` plus a per-route dedup suffix
// (`opengraph-image-v2by4x`). The suffix is a 6-character base36 hash — see `getMetadataRouteSuffix`
// in `next/dist/lib/metadata/get-metadata-route`. `twitter-image` is listed because the same file
// convention produces it, even though the template ships none today. No extension arm: the pattern
// is anchored, so a dotted last segment such as `opengraph-image.png` never matches.
const OG_IMAGE_SEGMENT_PATTERN = /^(?:opengraph|twitter)-image(?:-[0-9a-z]{6})?$/i

// The segment alone cannot prove the URL is a card: a post slug can wear it too, and `launch` is as
// valid a dedup hash as `v2by4x`. Only the `Accept` header tells them apart, and the edge HTML cache
// key names no header. So that cache skips every path that matches, a card or a page.
export function isOgImagePathname(pathname: string): boolean {
  return OG_IMAGE_SEGMENT_PATTERN.test(pathname.slice(pathname.lastIndexOf("/") + 1))
}
