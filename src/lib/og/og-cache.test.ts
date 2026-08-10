import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import { OG_IMAGE_CONTENT_TYPE } from "@/constants/og-image"

import { serveOgImageFromCache } from "./og-cache"

const CARD_URL = "https://example.com/opengraph-image"
// A crawler and an `<img>` both ask for anything; only a document navigation says `text/html`.
const CRAWLER_HEADERS = { accept: "*/*" }

function cardResponse(): Response {
  return new Response("png-bytes", {
    headers: { "content-type": OG_IMAGE_CONTENT_TYPE },
  })
}

// Minimal stand-in for the colo cache: one entry per key URL, matched on the URL alone, which is
// all this module relies on.
function createCacheStub() {
  const entries = new Map<string, Response>()

  return {
    entries,
    match: vi.fn(async (key: Request) => entries.get(key.url)?.clone()),
    put: vi.fn(async (key: Request, response: Response) => {
      entries.set(key.url, response)
    }),
  }
}

let cache: ReturnType<typeof createCacheStub>
let waitUntil: ReturnType<typeof vi.fn>

function call({
  url,
  method = "GET",
  headers = CRAWLER_HEADERS,
  render,
}: {
  url: string
  method?: string
  headers?: Record<string, string>
  render: (original: Request) => Promise<Response>
}) {
  const request = new Request(url, { method, headers })

  return serveOgImageFromCache({
    request,
    url: new URL(url),
    render,
    ctx: { waitUntil, passThroughOnException: () => undefined } as unknown as ExecutionContext,
  })
}

beforeEach(() => {
  cache = createCacheStub()
  waitUntil = vi.fn((promise: Promise<unknown>) => promise)
  vi.stubGlobal("caches", { default: cache })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("serveOgImageFromCache", () => {
  test("renders once for any number of query-string variants", async () => {
    const render = vi.fn(async (__original: Request) => cardResponse())

    for (const search of ["", "?af13cfa47c93b716", "?zzz1", "?zzz2", "?a=1&b=2"]) {
      const response = await call({ url: `${CARD_URL}${search}`, render })
      expect(response?.status).toBe(200)
    }

    expect(render).toHaveBeenCalledTimes(1)
    expect(cache.entries.size).toBe(1)
  })

  // The stored key never carries attacker input; the render still gets the URL the caller asked for.
  test("keys on the canonical URL, renders the caller's own", async () => {
    const render = vi.fn(async (__original: Request) => cardResponse())

    await call({ url: `${CARD_URL}?zzz1`, render })

    expect(cache.match.mock.calls[0]?.[0].url).toBe(CARD_URL)
    expect(cache.put.mock.calls[0]?.[0].url).toBe(CARD_URL)
    expect(render.mock.calls[0]?.[0].url).toBe(`${CARD_URL}?zzz1`)
  })

  // A key built as `new Request(url, request)` passes every other test here and splits the entry
  // back into one per crawler.
  test("builds the cache key with no headers", async () => {
    const render = vi.fn(async (__original: Request) => cardResponse())

    await call({
      url: `${CARD_URL}?zzz1`,
      headers: { ...CRAWLER_HEADERS, "user-agent": "crawler", "accept-encoding": "gzip" },
      render,
    })

    expect([...(cache.match.mock.calls[0]?.[0].headers.keys() ?? [])]).toEqual([])
    expect([...(cache.put.mock.calls[0]?.[0].headers.keys() ?? [])]).toEqual([])
  })

  // `opengraph-image-launch` is as valid a dedup suffix as a real post slug, so a page reaches here
  // whenever the client asks for `*/*`. It must be answered from its own URL, query and all.
  test("renders a card-shaped page from its own URL and stores nothing", async () => {
    const pageUrl = "https://example.com/blog/opengraph-image-launch?page=2"
    const render = vi.fn(async (__original: Request) =>
      new Response("<html>", { headers: { "content-type": "text/html" } }),
    )

    const response = await call({ url: pageUrl, render })

    expect(render.mock.calls[0]?.[0].url).toBe(pageUrl)
    expect(await response?.text()).toBe("<html>")
    expect(cache.put).not.toHaveBeenCalled()
  })

  test("keeps one entry per pathname", async () => {
    const render = vi.fn(async (__original: Request) => cardResponse())

    await call({ url: `${CARD_URL}?zzz1`, render })
    await call({ url: `https://example.com/es/opengraph-image?zzz1`, render })

    expect(render).toHaveBeenCalledTimes(2)
    expect(cache.entries.size).toBe(2)
  })

  // Without this an attacker just switches method and the enumeration is back.
  test("warms and reads the same entry for HEAD", async () => {
    const render = vi.fn(async (__original: Request) => cardResponse())

    const miss = await call({ url: `${CARD_URL}?zzz1`, method: "HEAD", render })
    expect(await miss?.text()).toBe("")
    expect(render.mock.calls[0]?.[0].method).toBe("GET")

    const hit = await call({ url: `${CARD_URL}?zzz2`, method: "GET", render })
    expect(await hit?.text()).toBe("png-bytes")
    expect(render).toHaveBeenCalledTimes(1)
  })

  test.each([
    ["a 404", new Response("Not found", { status: 404 })],
    ["a redirect", new Response(null, { status: 307, headers: { location: "/opengraph-image" } })],
    ["an HTML page", new Response("<html>", { headers: { "content-type": "text/html" } })],
  ])("does not store %s under the card's key", async (_case, stubbed) => {
    const render = vi.fn(async () => stubbed)

    await call({ url: `${CARD_URL}?zzz1`, render })

    expect(cache.put).not.toHaveBeenCalled()
    expect(cache.entries.size).toBe(0)
  })

  test("still answers when the cache write fails", async () => {
    cache.put.mockRejectedValueOnce(new Error("uncacheable"))
    const render = vi.fn(async (__original: Request) => cardResponse())

    const response = await call({ url: `${CARD_URL}?zzz1`, render })

    expect(await response?.text()).toBe("png-bytes")
    await expect(waitUntil.mock.results[0]?.value).resolves.toBeUndefined()
  })

  test.each([
    ["a page request", { url: CARD_URL, headers: { accept: "text/html" } }],
    ["a non-card path", { url: "https://example.com/blog" }],
    ["a POST", { url: CARD_URL, method: "POST" }],
  ])("falls through for %s", async (_case, overrides) => {
    const render = vi.fn(async (__original: Request) => cardResponse())

    expect(await call({ render, ...overrides } as Parameters<typeof call>[0])).toBeNull()
    expect(render).not.toHaveBeenCalled()
  })
})
