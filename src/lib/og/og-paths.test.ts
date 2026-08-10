import { describe, expect, test } from "vitest"

import { isOgImageRequest } from "./og-paths"

// What actually reaches a card: a social crawler, or the browser loading one into an `<img>`.
const CRAWLER_HEADERS = new Headers({ accept: "*/*" })
const IMAGE_HEADERS = new Headers({ accept: "image/avif,image/webp,image/apng,*/*;q=0.8" })
// Every browser sends `text/html` on a document navigation, and Next sends `RSC` on a client-side one.
const DOCUMENT_HEADERS = new Headers({
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
})
const RSC_HEADERS = new Headers({ accept: "text/x-component", rsc: "1" })

const CARD_PATHNAMES = [
  "/opengraph-image",
  "/es/opengraph-image",
  "/blog/opengraph-image-v2by4x",
  "/blog/some-post/opengraph-image-1ybbry",
  "/es/docs/api/opengraph-image-lqh7tr",
  "/twitter-image",
]

describe("isOgImageRequest", () => {
  describe.each([
    ["a crawler", CRAWLER_HEADERS],
    ["an <img>", IMAGE_HEADERS],
  ])("fetched by %s", (_client, headers) => {
    test.each(CARD_PATHNAMES)("matches %s", (pathname) => {
      expect(isOgImageRequest({ pathname, headers })).toBe(true)
    })

    // A slug only has to look like a card segment to lose its Set-Cookie, so the segment stays as
    // narrow as the convention allows: a dedup suffix is exactly 6 base36 characters.
    test.each([
      "/",
      "/blog",
      "/blog/opengraph-image-guide",
      "/blog/opengraph-image-is-not-a-card",
      "/docs/opengraph-images-explained",
      // A dotted path never gets this far: `shouldLocalizePathname` returns first in `proxy.ts`.
      "/blog/opengraph-image-v2by4x.png",
      "/icon.svg",
      "/sitemap.xml",
    ])("does not match %s", (pathname) => {
      expect(isOgImageRequest({ pathname, headers })).toBe(false)
    })
  })

  // The case no pathname can settle: `launch` is as valid a dedup hash as `v2by4x`, so this is both
  // the blog index card and a post URL. Only the request says which.
  const AMBIGUOUS_PATHNAME = "/blog/opengraph-image-launch"

  test("matches the ambiguous pathname when a crawler asks for it", () => {
    expect(isOgImageRequest({ pathname: AMBIGUOUS_PATHNAME, headers: CRAWLER_HEADERS })).toBe(true)
  })

  test.each([
    ["a document navigation", DOCUMENT_HEADERS],
    ["a client-side navigation", RSC_HEADERS],
  ])("keeps the cookie on %s of a card-shaped page", (_navigation, headers) => {
    expect(isOgImageRequest({ pathname: AMBIGUOUS_PATHNAME, headers })).toBe(false)
  })

  test.each(CARD_PATHNAMES)("never strips a navigation to %s", (pathname) => {
    expect(isOgImageRequest({ pathname, headers: DOCUMENT_HEADERS })).toBe(false)
  })
})
