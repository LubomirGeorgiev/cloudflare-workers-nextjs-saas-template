import { describe, expect, test } from "vitest"

import { isOgImagePathname } from "./og-paths"

describe("isOgImagePathname", () => {
  test.each([
    "/opengraph-image",
    "/es/opengraph-image",
    "/blog/opengraph-image-v2by4x",
    "/blog/some-post/opengraph-image-1ybbry",
    "/es/docs/api/opengraph-image-lqh7tr",
    "/twitter-image",
    // A slug can wear a valid dedup hash, so the path alone cannot tell it from a card.
    "/blog/opengraph-image-launch",
  ])("matches %s", (pathname) => {
    expect(isOgImagePathname(pathname)).toBe(true)
  })

  // A match keeps a page out of the edge HTML cache, so the segment stays as narrow as the
  // convention allows: a dedup suffix is exactly 6 base36 characters.
  test.each([
    "/",
    "/blog",
    "/blog/opengraph-image-guide",
    "/blog/opengraph-image-is-not-a-card",
    "/docs/opengraph-images-explained",
    "/blog/opengraph-image-v2by4x.png",
    "/icon.svg",
    "/sitemap.xml",
  ])("does not match %s", (pathname) => {
    expect(isOgImagePathname(pathname)).toBe(false)
  })
})
