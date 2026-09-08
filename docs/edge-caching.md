# Edge caching

What the Cloudflare edge stores in front of this Worker, and what it must never store.

## Two layers, and only one of them is Workers Caching

A public page is answered by two different caches, and confusing them is the mistake this section
exists to prevent:

1. **Workers Caching, in front of the Worker, stores no page.** A hit there skips the Worker, and
   with it the locale redirect, so the response a visitor reads still carries the page's own
   `no-store` policy. That has not changed.
2. **The Cache API, inside the Worker, stores the rendered page.** `caches.default` holds a copy
   under a synthetic key, so a warm anonymous request is answered from it and never runs the app
   render. The Worker still runs, so the locale decision still runs.

### Why the eyeball response is still uncacheable

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

### The stored page

`src/lib/edge/edge-html-cache.ts` owns the second layer, and `worker-entrypoint.ts` calls it. The
warm TTFB it removes was 390–450 ms of app render on every public page.

**The key is synthetic.** `https://<SITE_DOMAIN>/__edge-html/<build id><served pathname>` — a URL no request
ever carries. That is what keeps the two layers apart. Storing the eyeball response instead would
put a `public` policy on the page, and a `no-store` answer to the same URL would then **drop** the
stored copy for every visitor in that data center — the measured trap in "an uncacheable response
drops every variant" below. A signed-in visitor cannot reach this key at all, so they cannot evict
it. The key is built from `SITE_DOMAIN` rather than the request host so the purge, which runs
without a request, names exactly the same key.

**The stored copy is a rewritten clone.** Its `cache-control` is `EDGE_HTML_CACHE_CONTROL`
(`public, s-maxage=…`), which the Cache API honors and which overrides the page's own `no-store`;
its `Set-Cookie` is removed; the visitor's own policy is parked in a private header and put back on
a hit. So a hit and a miss leave the Worker with the same headers, and
`tests/e2e/cache-headers.test.ts` still sees an uncacheable page. The header
`x-edge-html-cache: hit | miss | bypass` is stamped on every HTML response;
`pnpm metrics:ttfb` prints it beside `cf-cache-status` in its `cache=` field.

**What gets stored** is the whole post-processed page — after `withHtmlAgentDiscovery`, after
`withoutOgCardCookie`, after the metadata stamp — so a hit carries the discovery relations, the
Early Hints `Link` header, and the `Vary` a miss carries. The body streams (Suspense), so the copy
is written through `ctx.waitUntil`; a visitor never waits on it. Only a `200` with a `text/html`
content type is written, and only from a `GET`.

### The gate

Every condition is decided from the URL and the request headers alone, before the app runs:

| Condition | Why |
| --- | --- |
| Method `GET` or `HEAD` | A `HEAD` may read the copy; only a `GET` writes one, because a `HEAD` answer carries no body. |
| No query string | `?page=2`, `?_rsc=…`, and every search-driven page are their own answers. |
| No `AUTH_SESSION_PRESENT_COOKIE_NAME` cookie | The one URL-visible signal that a page renders signed-in chrome. |
| No `RSC` / `Next-Url` / router headers | A client-side navigation asks the same URL for a flight payload, not a document. |
| `Accept` does not ask for Markdown | Guaranteed by order: the Markdown branch of `worker-entrypoint.ts` has already answered. |
| The path is a public page | `/`, `STATIC_PUBLIC_ROUTES`, and everything under `BLOG_BASE_PATH` and `DOCS_BASE_PATH`. |
| The path is not an OpenGraph card | A card and its page share a URL and differ only by `Accept`, which this key does not name. |
| The URL is the canonical one for its locale | `localizedPathname` decides it, so `as-needed` routing is honored: `/es/blog` qualifies, `/en/blog` does not, because next-intl answers that with a redirect. |
| next-intl must resolve the request to that locale | A prefixed path decides on its own. A bare path qualifies only when the locale cookie is absent or already the default, and `Accept-Language` names no other served locale. With `localeDetection` off (i18n disabled) next-intl negotiates nothing, so the gate skips the cookie and header checks and a stale locale cookie no longer forces a miss. |

That last row is what makes a bare path safe to store. `/blog` is the default locale's page only
for a visitor `src/proxy.ts` would not have redirected; anyone who signals another served locale
bypasses the copy and gets their `307`. The `Accept-Language` test is a deliberate substring match,
broader than the real negotiation: any mention of another served locale hands the decision back to
the proxy.

### The purge, and why it runs before the warm

`purgeEdgeHtmlPages({ pathnames })` deletes the key of each pathname in every locale of
`ENABLED_LOCALES`. It runs from the same places the Markdown twins are purged:

- `purgeCmsEntryEdgeHtmlPages` in `src/lib/cms/cms-entry-page-purge.ts` — the entry's own page and
  the listing above it.
- `purgeDocsNavigationMarkdownPages` in `src/lib/cms/cms-navigation-page-purge.ts` — the docs root
  and the docs app routes, which all bake the CMS sidebar.

**Ordering is the whole correctness argument.** `warmCmsEntryPages` fetches the published page over
the public internet, so a warm goes through this cache like any visitor. A purge that ran after the
warm would leave the pre-publish copy stored, and the warm itself would have re-stored it. So the
entry purge runs **inside** `invalidateEntryAndCollection`, in the same `Promise.all` that drops the
cache tags, which is awaited before the warm; and `warmPublishedEntry` in
`src/lib/cms/entry/mutations.ts` awaits its own purge — of every affected slug, so a rename does not
strand the old one — before it calls the warmer.

**A docs entry resolves its path from the navigation tree.** The docs collection publishes no
`previewUrl`, so `cmsEntryPagePath` returns `null` for it. `getCmsNavigationEntryPaths` in
`src/lib/cms/cms-navigation-entry-paths.ts` reads `cms_navigation_item.resolvedPath` straight from
D1 for the entry's slug, in any locale, and the purge adds it. Straight from D1 on purpose, for two
reasons: importing `cms-navigation-repository.ts` here closes an import cycle back through
`entry/index.ts`, and the cached tree is filtered by publish status, so an unpublish would resolve
no path exactly when the purge matters most.

One thing the purge still cannot name, bounded by `EDGE_HTML_CACHE_TTL_SECONDS` (300 s): **the
pages no list can enumerate** — blog pagination, tag, and author pages.

**The Cache API delete is per data center; the tag purge is not.** A `cache.delete` reaches the
colo that ran it. With Smart Placement (`placement.mode: "smart"` in `wrangler.jsonc`, status
SUCCESS on this Worker) the whole invocation runs at the placement location, so nearly every store
and every purge share one cache. For the rest, `purgeEdgeHtmlPages` also purges the same pages
zone-wide through `purgeZoneCacheTags` in `src/lib/cloudflare-api.ts`, which reaches every colo.

**By tag, never by URL.** Cloudflare cannot purge a URL that uses a custom cache key set by a
Worker, and this key is exactly that, so a `files:` purge would silently do nothing. Tags are the
documented way in: `storeEdgeHtmlPage` sets `Cache-Tag: edge-html:<build id>:<served pathname>` on
the stored copy, `restoreVisitorHeaders` strips it on a hit, and the purge names the same tags. The
tag builder takes the same argument as the key builder, so the two cannot disagree. Commas are
removed because they separate tags in the header.

Three rules keep the zone purge safe: it needs a `CLOUDFLARE_API_TOKEN` with `Cache Purge` and is
silent without one; it is skipped above `MAX_ZONE_PURGE_TAGS` (100, Cloudflare's per-request
ceiling) so a mutation stays one API call and the admin sweep uses `purge_everything` instead; and
it never throws, so a rate-limited zone cannot fail a publish. Purge requests are rate-limited per
account — 5 per minute on Free, 5 per second on Pro. The TTL bounds whatever does not get through.

**Four purge surfaces, four different stores.** The admin system panel offers all of them, and the
first three clear nothing in common. *Purge Edge HTML Cache* (`purgeEdgeHtmlCache` in
`src/lib/admin/system-actions.ts`, `POST /api/admin/v1/system/edge-html-cache/purge`) deletes the
stored pages above from `caches.default`: it names every public pathname the sitemap knows, in
every served locale, and touches nothing else. *Purge Workers CDN Cache* calls `cache.purge` from
`cloudflare:workers`, which clears only what Workers Caching holds — the routes in "What the edge
does store" below — and never a stored page or a KV key, because Workers Caching and the Cache API
are independent stores. *Purge Vinext KV Cache* deletes the KV keys behind the data cache and the
Markdown twins, and no edge copy at all.

The fourth is the blunt one. *Purge Cloudflare CDN Cache* (`purgeCloudflareCdnCache`,
`POST /api/admin/v1/system/cloudflare-cdn-cache/purge`) posts `purge_everything` to
`POST /zones/{zone_id}/purge_cache`, exactly as the deploy workflow's "Purge Cloudflare CDN cache"
step does. It is the only one that is global: every URL of the zone at every Cloudflare location,
the static assets included, and the stored page copies in **every** data center rather than the one
that ran the call. Use it when the three targeted purges cannot name what is stale; expect a
traffic spike, because every location refetches from the Worker afterwards.

The zone id is not configured. `getWorkerZoneId` in `src/lib/cloudflare-api.ts` reads it from
`GET /accounts/{account_id}/workers/domains?hostname=<SITE_DOMAIN>`, which needs only the
account-scoped `Workers Scripts:Read` the deploy token already carries, and memoizes it per isolate.
Set `CLOUDFLARE_ZONE_ID` only to override that lookup. The purge itself needs `Zone:Cache
Purge:Purge` on `CLOUDFLARE_API_TOKEN`; without a usable token and account id the panel hides the
card, and the REST operation refuses with `PRECONDITION_FAILED` naming what is missing.

### What else is cached

- **Data.** Reads behind a page go through `"use cache"` with `setCacheScope` from
  `src/utils/cache.ts`, and Vinext stores them in KV through `kvDataAdapter`. A CMS publish
  invalidates them by tag, so a render after a publish reads fresh rows. This is what a **miss**
  now pays, and it is why the section below still matters.
- **Markdown twins.** `src/lib/markdown-pages/serve-page.ts` converts a rendered page once and
  stores the result in KV. A CMS publish purges those entries.
- **Machine responses.** The routes in the next section, whose bodies depend on the URL alone.

### The data cache costs one KV read per tag

`kvDataAdapter` keeps one `__tag:` KV key per tag. On every `get` it reads the entry, then the
entry's own tags, then the implicit route tags Vinext adds — three sequential KV round trips for
one cached read. Two rules follow, and both were measured on a cold isolate in Asia:

- **Read fewer entries.** A page that always reads two values together must read them through one
  cached function with the union of their tags. `getPublicNavigationLinks` in
  `src/lib/cms/public-navigation-links.ts` is the example: the header asks "does the blog have
  posts?" and "does the docs tree have a root page?" on every public page, so one entry answers
  both, and a hit skips the whole navigation tree blob the second question used to read.
- **Hold the tag answers in memory.** `VINEXT_TAG_CACHE_TTL_MS` in `vite.config.ts` sets the
  adapter's `tagCacheTtlMs` to 60 s, up from its 5 s default. A warm isolate then reads no tag keys
  at all for a minute.
- **Hold the hottest entry bodies in memory too.** The tag answers were only half the cost: the
  entry itself is still one KV get per read. `memoForMs` in `src/utils/memo-for-ms.ts` sits between
  the React `cache` wrapper and the cached body of the three reads a public page cannot avoid —
  `getPublicNavigationLinks`, `resolveCurrentDocsPage`, and the docs navigation tree — so a warm
  isolate serves that navigation data with no KV get at all. Both windows come from one constant,
  `DATA_CACHE_MEMORY_TTL_MS` in `src/constants/data-cache.ts`, which `vite.config.ts` imports for
  `tagCacheTtlMs`, so they cannot drift apart. A settled entry answers with its value, never with
  the promise that produced it: a promise another request's I/O resolves may hang or throw once that
  request ends. A rejection is dropped, so one transient failure never fills the window.
- **Read each entry once per render.** Vinext runs no in-request dedupe for `"use cache"`
  (`vinext/dist/shims/cache-runtime.js`), so two callers in one render each did the KV get and the
  tag batch, and on a miss each repeated the D1 work. The docs page asked for the navigation tree
  three times that way. Every public cached reader now exports a React `cache` wrapper around its
  cached body — the two must stay separate functions, because a `"use cache"` directive and a
  `cache()` wrapper cannot share one function. `cache` keys on argument identity, so a wrapper
  passes primitives and rebuilds any object argument inside, which keeps the KV key unchanged.
  Declare the wrapper **after** the function it wraps: the transform rewrites that declaration into
  a `const`, and a wrapper above it would read the temporal dead zone. Outside a render — the API,
  MCP, and queue handlers — `cache` simply passes the call through.

A publish also warms what it just dropped. `warmCmsEntryPages` in `src/lib/cms/warm-cms-pages.ts`
runs at the end of `invalidateEntryAndCollection`. The editor save, the internal admin API, and the
queue timer therefore all warm. It reads the locales the entry has, then fetches the entry page, its
listing page, and the `.md` twin of each, so the first visitor reads a stored entry instead of
paying the D1 reads and the TipTap render. The fetches go through `runInBackground`, which uses
`waitUntil` and falls back to a plain promise where there is no request scope, so the publish never
waits for a warm and a failed warm never fails a publish. `MAX_WARM_URLS_PER_CALL` bounds one call,
and an isolate-wide in-flight URL set bounds an edit that invalidates many entries at once. Warming
is off on localhost and in test mode, because `global_fetch_strictly_public` sends every fetch to
the public internet and a loopback request never arrives.

The cost is a bounded staleness window. A publish writes the `__tag:` keys immediately, but an
isolate that did not run the purge keeps its memorized tag answers, and its memorized entry bodies,
for up to 60 s, so a published change can take that long to appear. The isolate that does run the
purge drops its own copies: every memoized reader builds its memo with `createNavigationMemo` in
`src/lib/cms/navigation-memos.ts`, which registers the memo's clear, and the CMS invalidation path
calls `clearNavigationMemos()` once beside the tag revalidation. One call is the whole contract, so
a new reader needs no invalidation change and no per-reader clear can be forgotten. A memo that also
sets `dedupePerRequest` keeps one limit: React `cache` holds the promise a request already read, so
the clear reaches the next request, not the read that is already in flight. Every affected page
still refreshes: the tags a merged read carries must stay a superset of the tags its parts carried,
or a publish stops reaching it.

Do not add `Vary: Accept-Language` or `Vary: Cookie` to bring page caching back to Workers Caching.
It compares the listed headers verbatim, so each distinct browser string becomes its own render, and
a `Cookie` key makes every signed-in visitor a variant. The stored page above is the fix that keeps
detection correct: the Worker reads those same signals itself, refuses the copy whenever they could
change the answer, and never lets a header into the key.

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

## Early Hints

A rendered page is not stored *in front of* the Worker, but its `Link` header is. Cloudflare
remembers the preload relations on a `200 text/html` response and replays them as a
`103 Early Hints` response to the next request for that URL, so the browser starts fetching the
render-critical assets while the Worker answers — from its stored copy, or from a render.

`withHtmlAgentDiscovery` in `worker-entrypoint.ts` adds those values, next to the discovery
relations, in one header. It sends them only on a `200` answer to a `GET`: an error page or a HEAD
probe would teach the edge the wrong hint for that URL, and no machine route, `.md` twin, or
redirect ever gets them.

What it sends, from `src/lib/assets/critical-preload-links.ts`:

| Value | Asset | Read from |
| --- | --- | --- |
| `<url>; rel="preload"; as="style"` | The stylesheet every page loads | The RSC assets manifest, under `src/components/root-shell.tsx` |
| `<url>; rel="modulepreload"` | The client bootstrap chunks (rolldown runtime, React framework, Vinext runtime) | `getPagesClientAssets()` from `vinext/server/pages-client-assets` |

Both names are hashed by the client build, so both are read back from the build. Never write one
down. The list is resolved once per isolate through `lazyValue`, and the module that resolves it is
reached by `await import()`, so nothing about it touches the startup path.

**Turn the zone setting on.** Cloudflare only sends the 103 when Early Hints is enabled for the
zone, under **Speed > Optimization > Content Optimization** in the dashboard. It is a zone setting,
not a Worker one: no header, `wrangler.jsonc` entry, or line of code here can switch it on.

## CMS image optimization

The Worker routes CMS sources at `/_next/image` through the existing CMS image route.
That route validates the R2 path and applies its rate limit. Vinext still validates widths,
quality, and content types and sets its image cache and security headers.
This path needs a separate source reader because the default optimizer only reads `ASSETS`.
Other images continue through the configured Vinext adapter.

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

## Workers Caching is configuration, not code

`wrangler.jsonc` turns on Cloudflare Workers Caching with `"cache": { "enabled": true }` (around line
25). The feature needs Wrangler 4.69.0 or above; this repo pins `^4.128.0` and compatibility date
`2026-08-03`.

The only code that calls the Cache API is `src/lib/edge/edge-html-cache.ts`, and it is the *inner*
layer: it stores pages under a synthetic key that no request carries. Everything in the table above
is stored by the *outer* layer instead, and no line of code puts it there — the response headers are
the whole mechanism. A reader who greps for `caches.default`, finds only the inner layer, and
concludes that the routes above are uncached has made the mistake this section exists to prevent;
four independent code reviewers made it when there was no such call at all.

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
Pages are no longer stored here, but the `.md` twins and the other routes above still are, and the
rule applies to them the same way. It is also the reason the stored page lives under a synthetic key
rather than on the page's own URL: on its own URL, one signed-in visitor or one `no-store` answer
would drop the copy for that whole data center.

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
  puts `vary: accept` on every HTML page that has a `.md` twin. Workers Caching stores no page, so
  today this only tells a downstream cache the truth. The inner layer never fans out on it: its key
  is the pathname, and the gate keeps every `Accept`-dependent answer (Markdown, OpenGraph cards)
  out of that key.

### Still to confirm after the next deploy

Re-run the A/B probe on a `.md` twin and read `cf-cache-status` on the 303. `HIT` is the intended
result. `EXPIRED` or `REVALIDATED` means `max-age=0` won over `s-maxage` — still stored, so the
eviction is still fixed; drop `max-age=0` to get the hits. `BYPASS` means Cloudflare declines to
store a 303: no regression, but the eviction stays.

Re-check this on a Wrangler or Vinext upgrade, the same as the other pinned-behavior audits.
