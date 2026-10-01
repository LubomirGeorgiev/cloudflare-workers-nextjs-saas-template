import { describe, expect, test, vi } from "vitest"

import { CACHE_TAGS, formatCacheTagHeader } from "@/constants/cache-tags"
import { OG_IMAGE_CACHE_CONTROL } from "@/constants/og-image"

vi.mock("server-only", () => ({}))

// Captures the options satori would get, so the test reads the headers without a rasterizer.
vi.mock("next/og", () => ({
  ImageResponse: class {
    constructor(_element: unknown, public options: { headers: Record<string, string> }) {}
  },
}))

const { renderOgImage } = await import("./og-image")

function headersOf(response: unknown): Record<string, string> {
  return (response as { options: { headers: Record<string, string> } }).options.headers
}

describe("renderOgImage", () => {
  test("sends no cache tag for a card that changes only on deploy", () => {
    expect(headersOf(renderOgImage({ title: "Terms" }))).toEqual({
      "cache-control": OG_IMAGE_CACHE_CONTROL,
    })
  })

  test("sends the given tags as one cache tag header", () => {
    const cacheTags = [CACHE_TAGS.CMS_TAGS, CACHE_TAGS.cmsCollection("blog"), CACHE_TAGS.CMS_TAGS]

    expect(headersOf(renderOgImage({ title: "Topic", cacheTags }))).toEqual({
      "cache-control": OG_IMAGE_CACHE_CONTROL,
      "cache-tag": formatCacheTagHeader(cacheTags),
    })
  })
})
