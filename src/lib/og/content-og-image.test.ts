import { beforeEach, describe, expect, test, vi } from "vitest"

import { CACHE_TAGS } from "@/constants/cache-tags"
import { DEFAULT_LOCALE } from "@/i18n/config"
import { DOCS_SLUG } from "@/lib/cms/docs-config"

const {
  getBlogEntriesWithAuthorsMock,
  getCmsEntryBySlugMock,
  getCmsTagsMock,
  renderOgImageWithLocalizedEyebrowMock,
  renderTranslatedOgImageMock,
  resolveBlogAuthorMock,
  resolveCurrentDocsPageMock,
} = vi.hoisted(() => ({
  getBlogEntriesWithAuthorsMock: vi.fn(),
  getCmsEntryBySlugMock: vi.fn(),
  getCmsTagsMock: vi.fn(),
  renderOgImageWithLocalizedEyebrowMock: vi.fn(),
  renderTranslatedOgImageMock: vi.fn(),
  resolveBlogAuthorMock: vi.fn(),
  resolveCurrentDocsPageMock: vi.fn(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/i18n/translator", () => ({ getTranslator: vi.fn(async () => (key: string) => key) }))
vi.mock("@/lib/cms/entry", () => ({ getCmsEntryBySlug: getCmsEntryBySlugMock }))
vi.mock("@/lib/cms/resolve-current-docs-page", () => ({
  resolveCurrentDocsPage: resolveCurrentDocsPageMock,
}))
vi.mock("@/lib/cms/resolve-blog-author", () => ({
  getBlogEntriesWithAuthors: getBlogEntriesWithAuthorsMock,
  resolveBlogAuthor: resolveBlogAuthorMock,
}))
vi.mock("@/lib/cms/tags", () => ({ getCmsTags: getCmsTagsMock }))
vi.mock("./translated-og-image", () => ({
  renderOgImageWithLocalizedEyebrow: renderOgImageWithLocalizedEyebrowMock,
  renderTranslatedOgImage: renderTranslatedOgImageMock,
}))

const {
  renderBlogAuthorOgImage,
  renderBlogPostOgImage,
  renderBlogTagOgImage,
  renderDocsOgImage,
} = await import("./content-og-image")

const locale = DEFAULT_LOCALE
const DOCS_NAVIGATION_TAGS = [CACHE_TAGS.cmsNavigation(DOCS_SLUG), CACHE_TAGS.cmsRedirect(DOCS_SLUG)]

// Every card, resolved or not, must carry the tags: a fallback card is stored under the same URL.
function renderedCacheTags(): unknown {
  const call = renderOgImageWithLocalizedEyebrowMock.mock.calls[0] ?? renderTranslatedOgImageMock.mock.calls[0]

  return (call?.[0] as { cacheTags?: unknown } | undefined)?.cacheTags
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("content OpenGraph card cache tags", () => {
  test.each([
    ["a published post", { title: "Launch", seoDescription: "Summary", content: null }],
    ["an unknown slug", null],
  ])("tags the blog post card for %s with its entry", async (_label, entry) => {
    getCmsEntryBySlugMock.mockResolvedValue(entry)

    await renderBlogPostOgImage({ locale, slug: "launch" })

    expect(renderedCacheTags()).toEqual([CACHE_TAGS.cmsEntry({ collectionSlug: "blog", slug: "launch" })])
  })

  test("tags a docs entry card with the navigation and its entry", async () => {
    resolveCurrentDocsPageMock.mockResolvedValue({
      type: "page",
      isFallback: false,
      node: { entry: { slug: "billing", title: "Billing", seoDescription: null } },
    })

    await renderDocsOgImage({ locale, slugParts: ["core", "billing"] })

    expect(renderedCacheTags()).toEqual([
      ...DOCS_NAVIGATION_TAGS,
      CACHE_TAGS.cmsEntry({ collectionSlug: DOCS_SLUG, slug: "billing" }),
    ])
  })

  test("tags an unresolved docs card with the navigation", async () => {
    resolveCurrentDocsPageMock.mockResolvedValue({ type: "not-found" })

    await renderDocsOgImage({ locale, slugParts: ["missing"] })

    expect(renderedCacheTags()).toEqual(DOCS_NAVIGATION_TAGS)
  })

  test.each([
    ["a known tag", [{ slug: "react", name: "React", description: null }]],
    ["an unknown tag", []],
  ])("tags the blog tag card for %s with the tag list", async (_label, tags) => {
    getCmsTagsMock.mockResolvedValue(tags)

    await renderBlogTagOgImage({ locale, slug: "react" })

    expect(renderedCacheTags()).toEqual([CACHE_TAGS.CMS_TAGS])
  })

  test.each([
    ["a known author", { author: { id: "usr_1", firstName: "Ada" }, entries: [] }],
    ["an unknown author", null],
  ])("tags the blog author card for %s with the blog collection", async (_label, resolved) => {
    getBlogEntriesWithAuthorsMock.mockResolvedValue([])
    resolveBlogAuthorMock.mockReturnValue(resolved)

    await renderBlogAuthorOgImage({ locale, authorRouteParam: "ada--usr_1" })

    expect(renderedCacheTags()).toEqual([CACHE_TAGS.cmsCollection("blog")])
  })
})
