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

The reason is the locale redirect. `src/proxy.ts` runs `decideLocaleRoute` on every page request:
it rewrites a bare default-locale path to its `[locale]` route, redirects a visitor with a locale
cookie or a matching `Accept-Language` to their locale. That logic runs inside the Worker. Workers Caching sits in front of the Worker, so an edge hit skips it.

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
its `Set-Cookie` is removed, because one stored copy answers every anonymous visitor; the
visitor's own policy is parked in a private header and put back on a hit. A hit sets no cookie.
Neither does a miss: the locale cookie records an explicit choice, so only an explicit choice
writes it (`src/i18n/locale-cookie.ts` names the writers), and `src/proxy.ts` and this cache
only read it. The rule is pinned in
`tests/integration/worker-edge.test.ts`. So a hit and a miss leave
the Worker with the same headers, and
`tests/e2e/cache-headers.test.ts` still sees an uncacheable page. The header
`x-edge-html-cache: hit | miss | bypass` is stamped on every HTML response;
`pnpm metrics:ttfb` prints it beside `cf-cache-status` in its `cache=` field.
A hit also carries `x-edge-html-cache-age`, the whole seconds since the copy was rendered. The
stored copy keeps the render time in a private header, and a hit removes it. We do not read the
Cache API's own `age`, because Cloudflare does not document it for `cache.match`.
In Workers traces, the `app.request` span copies the header value to `app.edge_html_cache`.
The cache read runs in a child span, `app.edge_html_cache.lookup`.

**What gets stored** is the whole post-processed page — after `withHtmlAgentDiscovery` and after
the metadata stamp — so a hit carries the discovery relations, the
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
| `decideLocaleRoute` serves the request | The decision `src/proxy.ts` acts on, called here with the same signals: the path prefix decides on its own, then the locale cookie, then `Accept-Language`. A redirect decision is a miss, so `as-needed` routing is honored: `/es/blog` qualifies, `/en/blog` and `/EN/blog` do not. With `LOCALE_DETECTION` off (i18n disabled) it negotiates nothing, so neither a stale cookie nor a foreign `Accept-Language` forces a miss. |
| The URL is the decision's canonical spelling | The proxy also serves other spellings of the same page (`//blog`, `/%62log`). A copy under one of those keys would outlive every purge, so only the canonical spelling is stored. |

The `decideLocaleRoute` row is what makes a bare path safe to store. `/blog` is the default locale's page only
for a visitor `src/proxy.ts` would not have redirected; anyone who signals another served locale
bypasses the copy and gets their `307`. Because both sides call `decideLocaleRoute`, the gate
cannot drift from the proxy — there is one rule, not a mirror of one.

### The purge, and why it runs before the warm

`purgeEdgeHtmlPages({ pathnames, subtreePathnames })` deletes the key of each pathname in every
locale of `ENABLED_LOCALES`. A subtree pathname also names every stored page under it. The subtree
`/` names every stored page. The function returns the local delete count and the zone outcome:
`ok`, `failed`, `unconfigured`, or `none`. It never throws.

Every CMS write reaches it through one function, `purgeCmsPages` in
`src/lib/cms/cms-entry-page-purge.ts`. That function sends one stored-HTML purge, then one `.md`
purge. The pure selector `selectCmsPagePurgeTargets` in the same file decides the pages:

- An entry with a page: the page, and its listing as a subtree and as a `.md` prefix.
- A navigation, named by a save or owned by the collection of a written entry: its `basePath` as a
  subtree and as a `.md` prefix. Every page under it bakes the sidebar, so one docs entry write
  changes all of them.
- The tag catalog scope: `CMS_TAGS_PAGE_PATH` as a subtree and as a `.md` prefix.
- The site header scope and the full CMS clear: the root subtree `/`, so every stored page. The
  site header scope adds no `.md` prefix (see "The site header" below).

The selector also names each page that it knows under one of those subtrees, because the local
delete cannot match a prefix (see below):

- A blog write: `BLOG_LISTING_ROUTES`, and every numbered page of the blog list and of each tag and
  author page. `getBlogListingPostCounts` in `src/lib/cms/blog-listing-post-counts.ts` reads the
  post counts straight from D1. A tag catalog write names only the tag pages of that list.
- A navigation: every `resolvedPath` of its tree, which `getCmsNavigationPagePaths` in
  `src/lib/cms/cms-navigation-entry-paths.ts` reads in any publish status. The docs navigation also
  names the docs app routes, `DOCS_EDGE_HTML_PATHNAMES`.
- The site header scope and the full CMS clear: the page of each published entry with a
  `previewUrl`. `runCmsInvalidation` reads every entry row once per pass, and passes the read to
  `purgeCmsPages` as `readAllEntryRefs`. A full clear uses the same rows for its entry tags. The
  page step treats a failed read as no rows: the root prefix and the TTL still apply.
- The pages a write moves away from, which D1 no longer names after the write. The caller reads
  them first and passes them as `knownPagePathnames`: the old slug of a renamed or deleted tag,
  the old page of a renamed author, the tree paths before a navigation save, and the page of a
  deleted docs entry.

`selectCmsPagePurgeReads` decides which of those reads one write needs, so the reads and the
selector cannot drift. Both passes get `knownPagePathnames`. Without a zone purge, only a delete by
name reaches a copy that a render stored between the two passes.

**Ordering is the whole correctness argument.** `warmCmsEntryPages` fetches the published page over
the public internet, so a warm goes through this cache like any visitor. A purge that ran after the
warm would leave the pre-publish copy stored, and the warm itself would have re-stored it. So the
entry purge runs **inside** `invalidateCmsEntries` in `src/lib/cms/cms-cache-invalidation.ts`, as
the page step of `runCmsCacheInvalidation`, after the cache tags drop and before the warm. It purges
every affected slug, so a rename does not strand the old one. `invalidateEntryAndCollection` is the
one-entry form of the same function.

**A docs entry resolves its path from the navigation tree.** The docs collection publishes no
`previewUrl`, so `cmsEntryPagePath` returns `null` for it. The purge reads the whole tree of the
entry's navigation with `getCmsNavigationPagePaths`, which includes the entry's own page. An entry
delete cascades the navigation row away, so the delete first reads the entry's path with
`getCmsNavigationEntryPaths` in the same file, one joined query (navigation item join entry) for
each chunk of 90 slugs, and passes it on. Both read straight from D1 on purpose, for two
reasons: importing `cms-navigation-repository.ts` here closes an import cycle back through
`entry/index.ts`, and the cached tree is filtered by publish status, so an unpublish would resolve
no path exactly when the purge matters most.

**The listing subtree goes by key prefix.** The entry purge names the listing as a subtree. The
zone purge then sends one `prefixes` request with `<SITE_DOMAIN>/__edge-html/<build id><listing>`
for each served locale. Cloudflare matches the raw string, so the prefix reaches the listing and
every page under it. A page under a purged prefix needs no tag, so the exact pages above add no
zone request. The local `cache.delete` cannot match a prefix, so it deletes only the named pages.
That is why the selector names every page it knows. Without an API token, a page that no read
names (for example, a numbered page that a write just removed) waits for
`EDGE_HTML_CACHE_TTL_SECONDS` (300 s) in that data center, and every page waits for it in other
data centers. The stored copy gets the short TTL then; see "TTLs and what bounds them" below.

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

Three rules keep the zone purge safe: it needs a `CLOUDFLARE_API_TOKEN` with `Cache Purge` and
reports `unconfigured` without one; the tags and the prefixes each go in their own requests, which
`src/lib/cloudflare-api.ts` chunks at 100 (`ZONE_PURGE_TAGS_PER_REQUEST`, Cloudflare's per-request
ceiling), so a long list is sent, not skipped; and it never throws, so a rate-limited zone cannot
fail a publish. It reports `failed` instead. A CMS pass sends one `purgeEdgeHtmlPages` call, so it
stays one request per kind. A blog entry write sends only the prefix request, because its pages sit
under the listing. Purge requests are rate-limited per account — 5 per minute on Free, 5 per second
on Pro. The TTL bounds whatever does not get through: one hour with the zone purge, 300 s without.

**Four purge surfaces, four different stores.** The admin system panel offers all of them, and the
first three clear nothing in common. *Purge Edge HTML Cache* (`purgeEdgeHtmlCache` in
`src/lib/admin/system-actions.ts`, `POST /api/admin/v1/system/edge-html-cache/purge`) deletes the
stored pages above from `caches.default`: it names every public pathname the sitemap knows, in
every served locale, and touches nothing else. It also names the root `/` as a subtree, so with
the zone purge it clears every stored page of this build in every data center. Run it after a var
or secret change, because no CMS write purges the config a page renders. When the zone purge
fails or is not configured, the result is partial, not an error: the REST response carries
`zonePurge: "failed"` or `zonePurge: "unconfigured"`, and the panel shows the message as a warning. *Purge Workers CDN Cache* calls `cache.purge` from
`cloudflare:workers`, which clears only what Workers Caching holds — the routes in "What the edge
does store" below — and never a stored page or a KV key, because Workers Caching and the Cache API
are independent stores. It refuses with `PRECONDITION_FAILED` when the runtime has no
`cache.purge`, as in local development. *Purge Vinext KV Cache* deletes the KV keys behind the data cache and the
Markdown twins, and no edge copy at all.

The fourth is the blunt one. *Purge Cloudflare CDN Cache* (`purgeCloudflareCdnCache`,
`POST /api/admin/v1/system/cloudflare-cdn-cache/purge`) posts `purge_everything` to
`POST /zones/{zone_id}/purge_cache`, exactly as the deploy workflow's "Purge Cloudflare CDN cache"
step does. It is the only one that is global: every URL of the zone at every Cloudflare location,
the static assets included, and the stored page copies in **every** data center rather than the one
that ran the call. Use it when the three targeted purges cannot name what is stale; expect a
traffic spike, because every location refetches from the Worker afterwards.
It does not clear Workers Caching: Cloudflare states that no zone-level purge affects that cache.
Use *Purge Workers CDN Cache* for it.

The zone id is not configured. `getWorkerZoneId` in `src/lib/cloudflare-api.ts` reads it from
`GET /accounts/{account_id}/workers/domains?hostname=<SITE_DOMAIN>`, which needs only the
account-scoped `Workers Scripts:Read` the deploy token already carries, and memoizes it per isolate.
It remembers a failed lookup for `WORKER_ZONE_LOOKUP_FAILURE_TTL_MS` (60 s) per isolate, so each
stored page does not pay another API call for the TTL check.
The deploy workflow's purge step does the same lookup for the hostname of
`resolveDeployedSiteUrl` in `scripts/utils/deploy-site-url.mjs`, so it also runs without
`CLOUDFLARE_ZONE_ID`. Set `CLOUDFLARE_ZONE_ID` only to override that lookup. A deploy without a
custom domain (no site URL, or a `workers.dev` host) skips the purge with a warning. For a custom
domain, a refused lookup or a host with no match fails the step, because readers would keep old pages. The purge itself needs `Zone:Cache
Purge:Purge` on `CLOUDFLARE_API_TOKEN`; without a usable token and account id the panel hides the
card, and the REST operation refuses with `PRECONDITION_FAILED` naming what is missing.

### What else is cached

- **Data.** Reads behind a page go through `"use cache"` with `setCacheScope` from
  `src/utils/cache.ts`, and Vinext stores them in KV through `kvDataAdapter`. A CMS publish
  invalidates them by tag, so a render after a publish reads fresh rows. This is what a **miss**
  now pays, and it is why the section below still matters. See "Every handler registers the KV
  data cache" below for the queue, cron, API, and MCP.
- **Markdown twins.** `src/lib/markdown-pages/serve-page.ts` converts a rendered page once and
  stores the result in KV. A CMS publish or tag change purges those entries before its Workers
  Caching purge.
- **Machine responses.** The routes in the next section, whose bodies depend on the URL alone.

### Every handler registers the KV data cache

Vinext registers `kvDataAdapter` only inside its page handler (`registerConfiguredCacheAdapters`,
generated from the `cache` option). The queue, the cron, `/api/v1`, `/mcp`, `/api/admin/v1`, and
`/mcp/admin` never reach that handler. In an isolate that had served no page, a tag drop there went
to Vinext's in-memory handler, and KV kept the old entries for their whole TTL. A scheduled publish,
the delayed repurge, and every CMS write through the API or MCP had this gap. We measured it on
2026-10-05 with the built Worker under `wrangler dev --local`: a cron-dispatched
`cms.repurge-entries` job wrote no `__tag:` key to KV until a page request had run in that isolate.

So every handler in `worker-entrypoint.ts` runs inside `runWithDataCache` from
`src/utils/data-cache-scope.ts`. It registers a lazy handler that calls the same generated
`registerConfiguredCacheAdapters`, so a page request imports nothing more. When a page request runs
first, Vinext's own registration wins, and the result is the same KV handler. It also runs the
handler in Vinext's execution context. Vinext's `revalidateTag` does not return its KV write. It
gives the write to `waitUntil`, and that context keeps the write alive. `revalidateCacheTag` runs
the call in a child context that catches the promise, so it waits for the write and throws its
error. The CMS pipeline relies on this: the page purge starts only after the tag markers land.

The `cache` option lives in `tools/vinext-cache-config.ts`, which `vite.config.ts` and the
integration runner share. `tests/integration/data-cache-registration.test.ts` runs a queued repurge
and a non-page fetch in a fresh isolate and reads the tag markers back from KV. Re-check this on a
Vinext upgrade.

### The data cache costs one KV read per tag

`kvDataAdapter` keeps one `__tag:` KV key per tag. On every `get` it reads the entry, then the
entry's own tags, then the implicit route tags Vinext adds — three sequential KV round trips for
one cached read. Two rules follow, and both were measured on a cold isolate in Asia:

- **Read fewer entries.** A page that always reads two values together must read them through one
  cached function with the union of their tags. `getPublicNavigationLinks` in
  `src/lib/cms/public-navigation-links.ts` is the example: the header asks "does the blog have
  posts?" and "does the docs tree have a live page?" on every public page, so one entry answers
  both, and a hit skips the whole navigation tree blob the second question used to read.
- **Hold the tag answers in memory.** `VINEXT_TAG_CACHE_TTL_MS` in `tools/vinext-cache-config.ts`
  sets the adapter's `tagCacheTtlMs` to 60 s, up from its 5 s default. A warm isolate then reads no
  tag keys at all for a minute.
- **Hold the hottest entry bodies in memory too.** The tag answers were only half the cost: the
  entry itself is still one KV get per read. `memoForMs` in `src/utils/memo-for-ms.ts` sits between
  the React `cache` wrapper and the cached body of the three reads a public page cannot avoid —
  `getPublicNavigationLinks`, `resolveCurrentDocsPage`, and the docs navigation tree — so a warm
  isolate serves that navigation data with no KV get at all. Both windows come from one constant,
  `DATA_CACHE_MEMORY_TTL_MS` in `src/constants/data-cache.ts`, which
  `tools/vinext-cache-config.ts` imports for `tagCacheTtlMs`, so they cannot drift apart. A settled entry answers with its value, never with
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
runs at the end of `invalidateCmsEntries`, after the Workers Caching purge. The editor save, the
internal admin API, and the queue timer therefore all warm. It reads the locales the entry has, then fetches the entry page, its
listing page, and the `.md` twin of each, so the first visitor reads a stored entry instead of
paying the D1 reads and the TipTap render. The delayed second purge below can drop these copies
again. The fetches go through `runInBackground`, which uses
`waitUntil` and falls back to a plain promise where there is no request scope, so the publish never
waits for a warm and a failed warm never fails a publish. `MAX_WARM_URLS_PER_CALL` bounds one call,
and an isolate-wide in-flight URL set bounds an edit that invalidates many entries at once. Warming
is off on localhost and in test mode, because `global_fetch_strictly_public` sends every fetch to
the public internet and a loopback request never arrives.

The cost is a bounded staleness window. A publish writes the `__tag:` keys immediately, but an
isolate that did not run the purge keeps its memorized tag answers, and its memorized entry bodies,
for up to 60 s, so a published change can take that long to appear. The isolate that does run the
purge drops its own copies: every memoized reader builds its memo with `createNavigationMemo` in
`src/lib/cms/navigation-memos.ts`, which registers the memo's clear, and `runCmsCacheInvalidation`
calls `clearNavigationMemos()` once, just after the tag revalidation. One call is the whole contract, so
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
| Generated OpenGraph cards | `OG_IMAGE_CACHE_CONTROL` | The card route; `src/proxy.ts` writes no cookie on any response |
| `/llms.txt`, `/docs/llms.txt` | `DOCS_LLMS_TXT_CACHE_CONTROL` | The route handler |
| `/api/docs/search` | `DOCS_SEARCH_CACHE_CONTROL` | The route handler |
| `/markdown/*` and `.md` twins | `CMS_MARKDOWN_CACHE_CONTROL`, `MARKDOWN_PAGE_CACHE_CONTROL` | `worker-entrypoint.ts` |
| `/sitemap.xml`, `/robots.txt` | `METADATA_ROUTE_EDGE_CACHE_CONTROL` | `worker-entrypoint.ts`, see below |
| OpenAPI document, API catalog | `STATIC_API_DOCUMENT_EDGE_CACHE_CONTROL` | Each producer |
| CMS images: `/api/cms-images/...` and the resized `/_next/image` copies | `CMS_IMAGE_CACHE_CONTROL` (`public, max-age=31536000, s-maxage=604800, immutable`) | The image route, and `optimizeCmsImage` in `src/lib/cms/optimize-cms-image.ts` |

Middleware must never add `Set-Cookie` to a card: Vinext pins any response that carries
`Set-Cookie` out of middleware to `no-store, must-revalidate`, overwriting the `Cache-Control` the
route set. Stripping the cookie afterwards leaves that policy behind, and every crawl re-rasterizes
the card through satori and resvg. `src/proxy.ts` writes no cookie at all, so no card gets one.

The constants live in `src/constants/cache-control.ts`, and `tests/e2e/cache-headers.test.ts`
asserts each route against the constant it uses, so a route cannot drift from its test.

The OpenAPI document and the API catalog change only on deploy. They need no purge: Workers
Caching partitions its cache by Worker version, so each deploy starts with a cold cache
([Cloudflare docs](https://developers.cloudflare.com/workers/cache/purge/)). A zone purge never
reaches Workers Caching.

### Cache tags on the stored routes

A tag is the only handle a CMS purge has on a stored response. Each route builds its
`Cache-Tag` header with `formatCacheTagHeader` in `src/constants/cache-tags.ts`, which removes
duplicates. A route that reads no CMS data sends no tag, because only a deploy changes it.

Each CMS section has one tag list in `src/lib/cms/cms-section-cache-tags.ts`. The cached loader of
the section passes it to `setCacheScope`, and the OG card and the `.md` twin of the section send
the same list. So one purge reaches all three.

| Route | Tags |
| --- | --- |
| Blog entry card | `blogEntryCacheTags`: `cmsEntry` of the blog slug |
| Docs card | `DOCS_NAVIGATION_CACHE_TAGS` (`cmsNavigation` and `cmsRedirect` of docs), plus `cmsEntry` of the docs slug when it resolves |
| Blog tag card | `CMS_TAGS_CACHE_TAGS` |
| Blog author card | `BLOG_COLLECTION_CACHE_TAGS` |
| Cards with static copy | None |
| `/api/docs/search` | `cmsSearchCollection` of docs |
| `/llms.txt`, `/markdown/*` | The tags of the reads behind the body |
| `.md` twin of an app page | `markdownPageCacheTags` in `src/lib/cms/cms-section-cache-tags.ts`, from the pathname |
| `/sitemap.xml` | `SITEMAP`, from `EDGE_CACHED_METADATA_ROUTE_TAGS` |
| CMS image and its resized copies | `cmsMedia` of the R2 key. A media delete and the R2 orphan sweep purge it. |

Each tag stays at or below `CACHE_TAG_MAX_LENGTH` (256 characters). Vinext's KV data cache ignores
a longer tag (`MAX_TAG_LENGTH` in `@vinext/cloudflare`), so a longer tag would leave the old data
entry live after a purge. The builder in `src/constants/cache-tags.ts` percent-encodes each part.
When the full tag is longer than the bound, the builder replaces it with the kind prefix and a short
stable hash. The header, the KV revalidation, and the purge call the same builder, so they always
name the same tag. A typical ASCII slug keeps its plain tag. Percent-encoding also keeps out the
characters that the data cache refuses (control characters, `\`, and `:`) and the comma that
separates tags in the header.

A fallback card carries the tags of its section too, because a later publish can make the same
URL resolve. `markdownPageCacheTags` gives a docs route `DOCS_NAVIGATION_CACHE_TAGS`, `/blog/tags`
and below `BLOG_TAG_PAGE_CACHE_TAGS`, and the other blog routes `BLOG_COLLECTION_CACHE_TAGS`.
Other pages get no tag.

### The CMS purge of Workers Caching

`revalidateCacheTag` drops only the KV data cache. Vinext's CDN adapter stays unconfigured, so
nothing in Vinext purges Workers Caching. So every CMS invalidation path calls
`runCmsCacheInvalidation` in `src/lib/cms/cms-cache-invalidation.ts` with one tag list. The paths
are an entry write, a navigation save, a tag group change, the full CMS clear, and the admin search
rebuild and clear.

**Order: KV, then the pages, then the edge purge, then the warm.** Each store refills from the
store before it, so each step waits for the step before it. `runCmsCacheInvalidation` does these
steps in this sequence:

1. It drops the KV cache tags of the list, and clears the navigation memos.
2. It runs the page step of the caller, if there is one. The page step deletes the stored HTML
   pages first and the KV `.md` twins second. The order of those two does not matter: a `.md` miss
   renders the page through the app (`nextAppHandler.fetch`), which reads KV, and never reads the
   stored HTML page. Both only need step 1 to finish first.
3. It sends one Workers Caching purge with the same tag list, through `purgeWorkersCacheAfterWrite`
   in `src/lib/edge/purge-workers-cache-after-write.ts`, and waits for it.

After that, `invalidateCmsEntries` starts the warm.

The page step of each path:

| Path | Page step (`purgeCmsPages`) |
| --- | --- |
| Entry write (`invalidateCmsEntries`) | The stored HTML of each entry and of its listing subtree, then the `.md` twins under each listing. For a collection with a navigation, also the whole navigation subtree (`/docs`), HTML and `.md`. When the write changed a publish state and may flip a header link, also the site header scope. |
| Entry delete (`invalidateDeletedCmsEntry`) | The same as an entry write. `deleteCmsEntry` reads the navigation path before the delete cascades the navigation row away, so the local Cache API delete still names the page. |
| Navigation save (`invalidateCmsNavigationCaches`) | The navigation subtree, HTML and `.md`. A docs navigation save that adds or removes pages, and may flip the header docs link, also adds the site header scope. |
| Tag group change (`invalidateCmsTagGroupCaches`) | The entry step for each affected entry, plus the tag catalog scope: `CMS_TAGS_PAGE_PATH` as a subtree, HTML and `.md`. A new tag with no entry still purges `/blog/tags`. The write sets `entryChange: "tags"`, so the KV drop keeps the collection counts, navigation, redirects, and search of those entries: a tag edit does not change them. |
| Full CMS clear (`invalidateAllCmsCaches`) | The root subtree: every stored page and every `.md` twin. For the local delete, also the page of each published entry, which adds no zone tag. |
| Admin search rebuild and clear | None. |

**The site header.** The header shows the blog link only while a post is published, and the docs
link only while the docs tree has a live page. It renders no path. Both answers are presence bits,
`hasBlogPosts` and `hasDocsPages`, from one cached read, `getPublicNavigationLinks`, tagged
`SITE_HEADER_CACHE_TAGS` from `src/lib/cms/cms-invalidation-scopes.ts`. The site header scope drops
those tags and purges the root subtree. One prefix is safe here: the key space
`<SITE_DOMAIN>/__edge-html/<build id>/` holds only stored public pages, and each one renders the
header. A miss costs one render. The header sits outside `<main>`, and a `.md` twin converts only
`<main>`, so this scope purges no `.md` twin.

Only a change of a live item set can flip a bit. So an entry write asks only when the writer says
that it moved an entry into or out of the published state, and in which direction. The writers
decide this with `getPublishStateChange`: create, update, delete, publish now, the scheduled
go-live, and a version restore. A content edit, an author write, and a media alt-text write never
ask, so they never add the site header scope. A navigation save asks only when it added or removed
a page entry (`selectNavigationPageChange`). A reorder or a rename keeps the page set, so it never
asks.

The write has committed, so only the live count after it is known. `mayHeaderLinkFlip` decides from
that count, read fresh from D1, and from the direction. Items outside the write keep their state. So
an empty set after the write was full before only if the write removed an item, and a full set was
empty before only if every live item is one that the write added. In all other cases the link did
not flip. A failed count adds the scope. The selector never misses a flip. It can purge once when
it was not necessary, when few items are live. The blog count is `getFreshPublishedBlogPostCount`.
The docs count is `getFreshCmsNavigationLivePageCount` in `src/lib/cms/cms-navigation-tree-query.ts`,
which builds the tree with the same code as the cached tree, so both apply the same live rule.

Each path sends one purge, with at most 100 tags per `cache.purge` call. A write that changes many
entries, for example a media update, calls `invalidateCmsEntries` once with all of them, so it
also sends one purge. The purge never throws: a failure leaves the stored copy to its TTL and never
fails the write. Before a purge, `purgeWorkersCacheTags` drops and logs each tag that is longer than
`CACHE_TAG_MAX_LENGTH`, because Cloudflare refuses the whole chunk for one bad tag. The tag
builder keeps every CMS tag inside that bound, so this drop is only a guard.

**A short stale window stays.** KV is eventually consistent. A write can take about 60 s to reach
all data centers, and a KV read can also come from the KV read cache. An isolate also keeps its tag
answers for 60 s (see "The data cache costs one KV read per tag" above). So a request in a different
data center, just after the purge, can read old KV data and store it at the edge. The warm can do
the same: in production, it stored an old `/blog.md` for its full hour.

**So every CMS write sends a delayed second purge.** After its first purge and its warm, each path
in the table above queues one `cms.repurge-entries` job on `SCHEDULER_QUEUE`, with
`delaySeconds` set to `CMS_REPURGE_DELAY_SECONDS` in `src/lib/cms/cms-cache-invalidation.ts`. The
delay is the KV propagation window (60 s) plus `DATA_CACHE_MEMORY_TTL_MS` (60 s), because an isolate
can read an old tag answer just before propagation ends and then keep it in memory. The message
carries the target of the write, and nothing else: the collection and the slug of each entry (at
most 25 per message) with the `entryChange` of the write, the `knownPagePathnames` (at most 10 per
message), the navigation keys, and the fixed scope names (`all-cms`, `site-header`, `tag-catalog`).
A deleted or renamed entry has no row to load, so the slug goes on the message. The navigations and
the scopes go on the first message of a split write. A path longer than
`CMS_REPURGE_PATHNAME_MAX_LENGTH` stays off the message; the subtree prefix and the TTL still apply. The queue
consumer calls `repurgeCmsCaches`, which runs the same `runCmsCacheInvalidation` for the same target:
the KV tags, the stored HTML, the `.md` twins, and the Workers Caching tags. It does not recompute the
header decision; the scope on the message repeats it. It does not warm, because a warm is what stored
the old copy, and the next visitor renders from fresh data. It does not queue another job, so it
cannot loop. A queue fault is logged and never fails the write. When the zone purge or the Workers
Caching purge of the delayed pass fails, the job throws, so the queue retries it up to the consumer's
`max_retries` in `wrangler.jsonc`. An `unconfigured` purge does not throw, because a retry cannot fix
it.

**Every handler can purge.** `cache.purge` is on the execution context of every handler, so the
queue consumer that runs a scheduled publish calls it directly
(<https://developers.cloudflare.com/workers/cache/purge/>). Workers Caching purges only the cache of
the entrypoint that calls `cache.purge`. The `fetch` and `queue` handlers are both in the default
export of `worker-entrypoint.ts`, so a queue purge drops the copies that `fetch` stored. A handler
in a named `WorkerEntrypoint` would purge its own cache, which is empty.

The local runtime has no `cache.purge` for any handler. There the purge reports
`skipped_unavailable`, so no local purge reaches an edge, and no local test can prove one.

The span `app.cms.cdn_purge` records `app.cms.tag_count` and `app.cms.outcome`: `ok`, `failed`, or
`skipped_unavailable`. A throw also records a span exception. The span `app.cms.invalidate` records
`app.cms.pass`: `initial` for the write, or `delayed` for the queued repeat. It records
`app.cms.scopes` and `app.cms.navigation` (a sorted list, or `none`), and
`app.cms.edge_html.zone_purge`: the zone outcome of the stored-HTML purge. `app.cms.collection` is
`none` for a target with no entry. The initial pass also records `app.cms.repurge.outcome`:
`scheduled` or `failed`.

**Verify the purge in production.** Publish a CMS entry from the editor, and schedule a publish of
another one. For each, find the `app.cms.cdn_purge` span. It must show `ok`, with a `tag_count`
above 0. The scheduled span is in the trace of the `app.queue` span. `skipped_unavailable` on
production means that the handler had no `cache.purge`, and the TTL of each route bounds the
staleness. `observability.traces.head_sampling_rate` in `wrangler.jsonc` samples traces, so one
publish can have no trace. To check, raise the rate in the Worker settings. The next deploy resets
it.

## TTLs and what bounds them

A purge makes most copies fresh. The TTL is the bound for what no purge reaches: a failed purge,
a change that no CMS write makes, and the copies in other data centers when the Worker has no zone
purge. Choose each TTL from that bound, not from the purge. `runCmsCacheInvalidation` returns one
`CmsCachePurgeOutcome` (`src/constants/cache-purge.ts`): the status of the zone purge and of the
Workers Caching purge, each `ok`, `failed`, or `unconfigured`. A CMS server action wraps its body in
`withCmsCachePurgeReport` (`src/lib/cms/cms-cache-purge-report.ts`), which adds the merged outcome
as `cachePurge` to the result, and the editor shows a warning toast from that field. The media
delete reports its Workers Caching purge in the same field. The system panel shows a failed purge as
a partial result. The API and MCP writes only log a failure.

| Layer | TTL | What purges it | What only the TTL bounds |
| --- | --- | --- | --- |
| Stored HTML page, zone purge configured | 1 h (`EDGE_HTML_CACHE_ZONE_PURGED_CACHE_CONTROL`) | Every CMS write: local delete and zone purge by tag and prefix, then the delayed repurge | A failed purge, a var or secret change (the build id does not change), the GitHub star count, the copyright year |
| Stored HTML page, no zone purge | 300 s (`EDGE_HTML_CACHE_TTL_SECONDS`) | The local delete only | Every copy in another data center |
| KV data cache, CMS reads | 8 h (`CMS_DATA_CACHE_TTL`) | KV tag drop of every CMS write, and again in the delayed repurge | A failed tag drop |
| KV data cache, GitHub stars | 1 h | None | The count, and a failed fetch (`null`) |
| In-isolate memo and tag answers | 60 s (`DATA_CACHE_MEMORY_TTL_MS`) | The isolate that runs the purge | Other isolates. The repurge delay depends on it, so do not raise it |
| KV `.md` twin | 1 h (`MARKDOWN_PAGE_CACHE_TTL_SECONDS`) | KV delete of every CMS write, key has the build id | App pages render config and the star count in `<main>` |
| Workers Caching: `.md`, `/markdown/*`, `/llms.txt`, sitemap | 1 h, stale 1 day | Workers Caching tag purge (needs no token) | The refill reads the KV data cache, so it is as fresh as that |
| Workers Caching: docs search | 300 s, stale 1 h | The search tag | Same as above |
| Workers Caching: OG cards | 1 day, stale 7 days; browser 1 h | Section tags | Browser copies |
| Workers Caching: OpenAPI document, API catalog | 7 days, stale 1 day | None needed: each Worker version, a var or secret change included, starts a cold cache | Nothing |
| Workers Caching: CMS images | 7 days at the edge; browser 1 year | Media delete and the R2 orphan sweep, by `cmsMedia` tag | A failed delete purge; browser copies |

Rules that keep these safe:

- A layer whose content changes only on deploy can go long. Its key or its cache must change with
  the version.
- A `stale-while-revalidate` window adds to the worst case of a failed purge. Do not raise one.
- No purge reaches a browser. Do not raise a browser `max-age` on content that can change.
- `storeEdgeHtmlPage` picks the long TTL only when `isZonePurgeConfigured` answers yes. It asks
  inside `waitUntil`, so the lookup never delays the visitor. Without the zone purge, a CMS write
  reaches only one data center, so the copy keeps the 300 s TTL that the admin warnings state.
- A rollback inside the TTL serves the copies stored under the older build id, which miss the CMS
  writes since. Run *Purge Edge HTML Cache* after a rollback.

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
`src/constants/cache-control.ts`. The sitemap also carries its `sitemap` cache tag. A CMS publish
purges the edge copy through the Workers Caching purge above, so the hour is only a backstop.

Re-check this on a Vinext upgrade, the same as the other pinned-behavior audits.

## Workers Caching is configuration, not code

`wrangler.jsonc` turns on Cloudflare Workers Caching with `"cache": { "enabled": true }` (around line
25). The feature needs Wrangler 4.69.0 or above; `package.json` pins a later version.

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
client that once asked for Markdown does not keep redirecting itself. On 2026-10-01 the live
site answered the 303 with `cf-cache-status: HIT`, so Cloudflare stores it as intended.

The safety argument is that the cache key partitions more finely than the branch it feeds. The
variant key is the exact `Accept` string, and `prefersMarkdownRepresentation` reads that same string.
Two requests that share a variant key therefore always get the same answer from the Worker, so a
stored 303 only ever reaches a caller who would have received that 303 live. A browser `Accept`
string never names `text/markdown`, so it never matches that variant.

### Known gaps, both bounded

- **Purge skew.** A `.md` twin carries the tags of `markdownPageCacheTags`, but the edge builds
  the 303 before any render, so the 303 variant carries no tag. A tag purge may leave it behind. The redirect target is a pure function of the
  pathname, so a CMS publish can never make a stale 303 wrong. Only removing a page from the Markdown
  allowlist could, and then the agent gets a 404 from the `.md` — never wrong content — for at most
  the TTL.
- **Variant fan-out.** `withHtmlDiscoveryLinkHeader` (`src/lib/markdown-pages/discovery-links.ts`)
  puts `vary: accept` on every HTML page that has a `.md` twin. Workers Caching stores no page, so
  today this only tells a downstream cache the truth. The inner layer never fans out on it: its key
  is the pathname, and the gate keeps every `Accept`-dependent answer (Markdown, OpenGraph cards)
  out of that key.

Re-check this on a Wrangler or Vinext upgrade, the same as the other pinned-behavior audits.
