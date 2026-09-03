# Edge caching

What the Cloudflare edge stores in front of this Worker, and what it must never store.

## HTML pages are never stored at the edge

Every public page under `src/app/[locale]/` renders on each request. The root layout,
`src/app/[locale]/layout.tsx`, exports `dynamic = "force-dynamic"`, and no page exports
`revalidate` or `dynamic = "force-static"`. `tests/e2e/cache-headers.test.ts` fails if one starts
to.

The layout export is load-bearing. Without it, Vinext takes the shortest `cacheLife` among the
`"use cache"` reads in a render as the page's own revalidate interval, so a page with no
`revalidate` export still came back with `s-maxage=3600`. A child segment can override the layout's
`dynamic`, which is why the E2E test checks the pages and not the layout.

The reason is the locale redirect. `src/proxy.ts` runs next-intl on every page request: it
rewrites a bare default-locale path to its `[locale]` route, redirects a visitor with a locale
cookie or a matching `Accept-Language` to their locale, and sets the locale cookie. That logic
runs inside the Worker. Workers Caching sits in front of the Worker, so an edge hit skips it.

We measured this on the deployed site before the change. Once `/` was stored, a request with
`Accept-Language: es` or with the `es` locale cookie got the stored English page with a `HIT`,
where a cold request got a `307` to `/es`. The cache key names the path and `Accept`, not the
locale signals, so the first visitor after a deploy decided the language for everyone.

Vinext draws the same conclusion. From `vinext@1.0.0-beta.9` its CDN adapter marks every
middleware-eligible route dynamic and stamps `no-store` on it, because a CDN hit would skip the
middleware. The template no longer configures that adapter, so `cache.cdn` is absent from
`vite.config.ts` and the deploy runs no warmup stage.

What is cached instead:

- **Data.** Reads behind a page go through `"use cache"` with `setCacheScope` from
  `src/utils/cache.ts`, and Vinext stores them in KV through `kvDataAdapter`. A CMS publish
  invalidates them by tag, so a render after a publish reads fresh rows.
- **Markdown twins.** `src/lib/markdown-pages/serve-page.ts` converts a rendered page once and
  stores the result in KV. A CMS publish purges those entries.
- **Machine responses.** The routes in the next section, whose bodies depend on the URL alone.

Do not add `Vary: Accept-Language` or `Vary: Cookie` to bring page caching back. Workers Caching
compares the listed headers verbatim, so each distinct browser string becomes its own render, and
a `Cookie` key makes every signed-in visitor a variant. The fix that keeps detection correct is an
uncached outer entrypoint that owns the locale logic in front of a cached inner one. That is a
larger change, and it is not done.

## What the edge does store

Each of these responses is a pure function of its URL, so a hit that skips the Worker is safe:

| Route | Policy | Set by |
| --- | --- | --- |
| Generated OpenGraph cards | `OG_IMAGE_CACHE_CONTROL` | The card route; `worker-entrypoint.ts` strips the locale cookie from it |
| `/llms.txt`, `/docs/llms.txt` | `DOCS_LLMS_TXT_CACHE_CONTROL` | The route handler |
| `/api/docs/search` | `DOCS_SEARCH_CACHE_CONTROL` | The route handler |
| `/markdown/*` and `.md` twins | `CMS_MARKDOWN_CACHE_CONTROL`, `MARKDOWN_PAGE_CACHE_CONTROL` | `worker-entrypoint.ts` |
| `/sitemap.xml`, `/robots.txt` | `METADATA_ROUTE_EDGE_CACHE_CONTROL` | `worker-entrypoint.ts`, see below |
| OpenAPI document, API catalog | `STATIC_API_DOCUMENT_EDGE_CACHE_CONTROL` | Each producer |

The constants live in `src/constants/cache-control.ts`, and `tests/e2e/cache-headers.test.ts`
asserts each route against the constant it uses, so a route cannot drift from its test.

## Metadata routes do not get a timer

`sitemap.xml` and `robots.txt` are metadata routes, not pages, so `export const revalidate` does
nothing for them. Vinext gives every metadata route a fixed `public, max-age=0, must-revalidate`
(`vinext/dist/server/metadata-route-response.js`), and its outer ISR cache there only turns on when
the route's **default export** itself carries a `"use cache"` directive. Ours is a thin
`await import()` wrapper, kept thin on purpose for the startup budget, so the cache never engages.

So the edge policy is stamped in `worker-entrypoint.ts` instead, from
`METADATA_ROUTE_EDGE_CACHE_CONTROL` and `EDGE_CACHED_METADATA_ROUTE_TAGS` in
`src/constants/cache-control.ts`. The sitemap also carries its `sitemap` cache tag, so a CMS publish
purges the edge copy through `revalidateCacheTag` and the hour is only a backstop.

Re-check this on a Vinext upgrade, the same as the other pinned-behavior audits.

## The edge cache is Workers Caching, not the Cache API

`wrangler.jsonc` turns on Cloudflare Workers Caching with `"cache": { "enabled": true }` (around line
25). The feature needs Wrangler 4.69.0 or above; this repo pins `^4.128.0` and compatibility date
`2026-08-03`.

Nothing in `src/` or `worker-entrypoint.ts` calls `caches.default` or `caches.open`. A grep for the
Cache API finds nothing, so a reader concludes that no edge cache runs. That conclusion is wrong: the
mechanism here is configuration, not code. Four independent code reviewers made that exact mistake,
which is why this section exists.

Workers Caching is also not the zone cache. Zone Cache Rules, Page Rules, and cache level settings do
not change it. The response headers the Worker sends are the whole configuration surface:

| Response header | What Workers Caching does |
| --- | --- |
| `cache-control: public, s-maxage=…` | Stores the response and serves it until the TTL ends. |
| `cache-control: no-store` or `private` | Does not store the response, and reports `Cf-Cache-Status: BYPASS`. It also drops the cache entry that already exists for that key. See the probe below. |
| `vary: accept` | Stores one variant per distinct value of the listed request header, per RFC 9110/9111. It compares those values verbatim, with no normalization. |
| `cache-tag: …` | Gives the purge identity. All variants of one URL must carry the same tags; different tags on different variants give inconsistent purges. |

### Measured: an uncacheable response drops every variant

The docs say a `no-store` response is not stored. They do not say what happens to the entry that is
already there. We measured it on the deployed site, on `/docs/mcp`, while pages were still stored:

- **A — a cacheable variant miss evicts nothing.** Prime the browser `Accept` variant (HIT). Request
  with `Accept: application/x-test` (MISS, then HIT). Return to the browser `Accept`: still **HIT**.
  Two variants coexist, and both stay alive.
- **B — an uncacheable response kills both.** Request with `Accept: text/markdown`, which returned a
  `no-store` 303 (`cf-cache-status: BYPASS`). The browser `Accept` variant is then **MISS**, and the
  `x-test` variant is **MISS** too.

So the whole entry goes, and every `vary: accept` variant goes with it. One request cold-flushed the
stored copy for every visitor in that data center. Anyone could do it, with no auth and one header.
Pages are no longer stored, but the `.md` twins and the other routes above still are, and the rule
applies to them the same way.

That is why `MARKDOWN_NEGOTIATION_CACHE_CONTROL` in `src/constants/cache-control.ts` is
`public, max-age=0, s-maxage=…` and not `no-store`. A stored 303 becomes its own variant beside the
HTML instead of an invalidation of it. `max-age=0` keeps it out of private browser caches, so a
client that once asked for Markdown does not keep redirecting itself.

The safety argument is that the cache key partitions more finely than the branch it feeds. The
variant key is the exact `Accept` string, and `prefersMarkdownRepresentation` reads that same string.
Two requests that share a variant key therefore always get the same answer from the Worker, so a
stored 303 only ever reaches a caller who would have received that 303 live. A browser `Accept`
string never names `text/markdown`, so it never matches that variant.

### Known gaps, both bounded

- **Purge skew.** A rendered page carries a `cache-tag` (`src/lib/markdown-pages/serve-page.ts`
  reads one back off a render), and the edge builds the 303 before any render, so the 303 variant
  carries no tag. A tag purge may leave it behind. The redirect target is a pure function of the
  pathname, so a CMS publish can never make a stale 303 wrong. Only removing a page from the Markdown
  allowlist could, and then the agent gets a 404 from the `.md` — never wrong content — for at most
  the TTL.
- **Variant fan-out.** `withHtmlDiscoveryLinkHeader` (`src/lib/markdown-pages/discovery-links.ts`)
  puts `vary: accept` on every HTML page that has a `.md` twin. Pages are not stored, so today this
  only tells a downstream cache the truth. It matters again the day a page is stored.

### Still to confirm after the next deploy

Re-run the A/B probe on a `.md` twin and read `cf-cache-status` on the 303. `HIT` is the intended
result. `EXPIRED` or `REVALIDATED` means `max-age=0` won over `s-maxage` — still stored, so the
eviction is still fixed; drop `max-age=0` to get the hits. `BYPASS` means Cloudflare declines to
store a 303: no regression, but the eviction stays.

Re-check this on a Wrangler or Vinext upgrade, the same as the other pinned-behavior audits.
